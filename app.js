/*
 * Configure these two values from Supabase > Project Settings > API.
 * Use the Project URL and the publishable/anon key ONLY.
 * NEVER put a Supabase service_role/secret key in this browser file.
 */
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE";
const BUCKET = "certificates";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

let db = null;
let currentUser = null;
let currentProfile = null;
let latestFacultyRows = [];

const $ = (id) => document.getElementById(id);
const isConfigured = () => SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes("PASTE_");

function notify(message, type = "info") {
  const el = $("notice");
  el.textContent = message;
  el.className = `notice show ${type}`;
  el.scrollIntoView({behavior:"smooth", block:"nearest"});
}
function clearNotice(){ const el=$("notice"); el.textContent=""; el.className="notice"; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function show(id, yes=true){ $(id).classList.toggle("hidden", !yes); }
function fileSafeName(name){ return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120); }
function formatDate(v){ if(!v)return "—"; const d=new Date(`${v}T00:00:00`); return Number.isNaN(d.getTime())?v:d.toLocaleDateString(); }
function statusPill(status){ return `<span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span>`; }

function showAuth(mode="login"){
  show("auth-panel", true); show("app-panel", false);
  show("login-form", mode==="login"); show("signup-form", mode==="signup");
  $("show-login").classList.toggle("active",mode==="login");
  $("show-signup").classList.toggle("active",mode==="signup");
}
function showApp(){
  show("auth-panel", false); show("app-panel", true);
  $("welcome").textContent = currentProfile?.full_name || currentUser?.email || "Account";
  $("account-role").textContent = currentProfile?.role === "faculty" ? "Faculty · Verification access" : "Student · Certificate submissions";
  const faculty = currentProfile?.role === "faculty";
  show("faculty-panel", faculty); show("student-panel", !faculty);
  if(faculty) loadFacultyRows(); else loadStudentRows();
}
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("id,full_name,roll_number,section,role").eq("id",currentUser.id).single();
  if(error) throw error;
  currentProfile=data;
}
async function refreshSession(){
  const {data,error}=await db.auth.getSession();
  if(error) throw error;
  currentUser=data.session?.user ?? null;
  if(!currentUser){ showAuth("login"); return; }
  await loadProfile();
  showApp();
}
function niceError(err){
  const message=err?.message || String(err);
  if(message.toLowerCase().includes("row-level security")) return "Access denied by database security policy. Check the Supabase SQL setup and your account role.";
  if(message.toLowerCase().includes("duplicate key")) return "This roll number may already be registered. Contact the portal administrator if you need help.";
  return message;
}

$("show-login").addEventListener("click",()=>showAuth("login"));
$("show-signup").addEventListener("click",()=>showAuth("signup"));

$("login-form").addEventListener("submit",async(e)=>{
  e.preventDefault(); clearNotice();
  try{
    const {data,error}=await db.auth.signInWithPassword({email:$("login-email").value.trim(),password:$("login-password").value});
    if(error) throw error;
    currentUser=data.user;
    await loadProfile(); showApp(); notify("Signed in successfully.","success");
  }catch(err){notify(niceError(err),"error");}
});

$("signup-form").addEventListener("submit",async(e)=>{
  e.preventDefault(); clearNotice();
  const email=$("signup-email").value.trim();
  const full_name=$("signup-name").value.trim();
  const roll_number=$("signup-roll").value.trim().toUpperCase();
  const section=$("signup-section").value;
  const password=$("signup-password").value;
  if(password.length<8){notify("Choose a password with at least 8 characters.","error");return;}
  try{
    const {data,error}=await db.auth.signUp({email,password,options:{data:{full_name,roll_number,section}}});
    if(error) throw error;
    if(data.session){
      currentUser=data.user;
      await loadProfile(); showApp();
      notify("Student account created. You can now submit certificates.","success");
    }else{
      notify("Registration received. Check your email to confirm the account, then sign in. If no email arrives, check Supabase Auth settings.","success");
      showAuth("login");
    }
  }catch(err){notify(niceError(err),"error");}
});

$("signout").addEventListener("click",async()=>{
  const {error}=await db.auth.signOut();
  if(error){notify(niceError(error),"error");return;}
  currentUser=null;currentProfile=null;showAuth("login");notify("Signed out.","success");
});

$("submission-form").addEventListener("submit",async(e)=>{
  e.preventDefault(); clearNotice();
  const file=$("certificate-file").files[0];
  if(!file){notify("Choose a certificate file first.","error");return;}
  if(file.size>MAX_FILE_BYTES){notify("The certificate file must be 5 MB or smaller.","error");return;}
  const allowed=["application/pdf","image/jpeg","image/png"];
  if(!allowed.includes(file.type)){notify("Upload a PDF, JPG, or PNG file only.","error");return;}
  const event_name=$("event-name").value.trim();
  const event_date=$("event-date").value;
  const event_type=$("event-type").value;
  const organiser=$("organiser").value.trim();
  const path=`${currentUser.id}/${crypto.randomUUID()}-${fileSafeName(file.name)}`;
  try{
    const {error:uploadError}=await db.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError) throw uploadError;
    const {error:insertError}=await db.from("submissions").insert({
      student_id:currentUser.id, event_name,event_date,event_type,organiser:organiser||null,
      certificate_path:path, original_file_name:file.name, status:"pending"
    });
    if(insertError){
      await db.storage.from(BUCKET).remove([path]);
      throw insertError;
    }
    $("submission-form").reset();
    notify("Certificate submitted for faculty verification.","success");
    await loadStudentRows();
  }catch(err){notify(niceError(err),"error");}
});

async function signedDownload(path, filename){
  const {data,error}=await db.storage.from(BUCKET).createSignedUrl(path,60);
  if(error) throw error;
  const a=document.createElement("a");a.href=data.signedUrl;a.download=filename||"certificate";a.target="_blank";a.rel="noopener";
  document.body.appendChild(a);a.click();a.remove();
}
async function loadStudentRows(){
  const target=$("student-submissions");
  target.innerHTML="<p class='muted'>Loading submissions…</p>";
  try{
    const {data,error}=await db.from("submissions").select("id,event_name,event_date,event_type,organiser,status,rejection_reason,created_at,original_file_name,certificate_path").eq("student_id",currentUser.id).order("created_at",{ascending:false});
    if(error) throw error;
    if(!data.length){target.innerHTML="<p class='muted'>You have not submitted any certificates yet.</p>";return;}
    target.innerHTML=`<table><thead><tr><th>Event</th><th>Date</th><th>Type</th><th>Status</th><th>Faculty note</th><th>Certificate</th></tr></thead><tbody>${data.map(r=>`<tr><td>${escapeHtml(r.event_name)}</td><td>${formatDate(r.event_date)}</td><td>${escapeHtml(r.event_type)}</td><td>${statusPill(r.status)}</td><td>${escapeHtml(r.rejection_reason||"—")}</td><td><button class="secondary" data-download="${escapeHtml(r.id)}">Download</button></td></tr>`).join("")}</tbody></table>`;
    target.querySelectorAll("[data-download]").forEach(b=>b.addEventListener("click",async()=>{
      const row=data.find(r=>r.id===b.dataset.download);
      try{await signedDownload(row.certificate_path,row.original_file_name);}catch(err){notify(niceError(err),"error");}
    }));
  }catch(err){target.innerHTML="";notify(niceError(err),"error");}
}

async function loadFacultyRows(){
  const target=$("faculty-submissions");
  target.innerHTML="<p class='muted'>Loading records…</p>";
  const filter=$("faculty-filter").value;
  const section=$("section-filter").value;
  try{
    let query=db.from("submissions").select("id,student_id,event_name,event_date,event_type,organiser,status,rejection_reason,created_at,original_file_name,certificate_path,profiles!submissions_student_id_fkey(full_name,roll_number,section)").order("created_at",{ascending:false});
    if(filter!=="all") query=query.eq("status",filter);
    const {data,error}=await query;
    if(error) throw error;
    let rows=data||[];
    if(section!=="all") rows=rows.filter(r=>r.profiles?.section===section);
    latestFacultyRows=rows;
    if(!rows.length){target.innerHTML="<p class='muted'>No submissions match these filters.</p>";return;}
    target.innerHTML=`<table><thead><tr><th>Student</th><th>Roll number</th><th>Section</th><th>Event</th><th>Date</th><th>Status</th><th>Certificate</th><th>Faculty action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.profiles?.full_name||"—")}</td><td>${escapeHtml(r.profiles?.roll_number||"—")}</td><td>${escapeHtml(r.profiles?.section||"—")}</td><td>${escapeHtml(r.event_name)}</td><td>${formatDate(r.event_date)}</td><td>${statusPill(r.status)}${r.rejection_reason?`<div class="muted">${escapeHtml(r.rejection_reason)}</div>`:""}</td><td><button class="secondary" data-file="${escapeHtml(r.id)}">View file</button></td><td><div class="actions"><button class="primary" data-approve="${escapeHtml(r.id)}" ${r.status==="approved"?"disabled":""}>Approve</button><button class="secondary" data-reject="${escapeHtml(r.id)}" ${r.status==="rejected"?"disabled":""}>Reject</button></div></td></tr>`).join("")}</tbody></table>`;
    target.querySelectorAll("[data-file]").forEach(b=>b.addEventListener("click",async()=>{
      const row=rows.find(r=>r.id===b.dataset.file);
      try{await signedDownload(row.certificate_path,row.original_file_name);}catch(err){notify(niceError(err),"error");}
    }));
    target.querySelectorAll("[data-approve]").forEach(b=>b.addEventListener("click",()=>updateStatus(b.dataset.approve,"approved",null)));
    target.querySelectorAll("[data-reject]").forEach(b=>b.addEventListener("click",()=>{
      const reason=prompt("Enter a short reason for rejection:");
      if(reason===null)return;
      if(!reason.trim()){notify("Please enter a rejection reason.","error");return;}
      updateStatus(b.dataset.reject,"rejected",reason.trim());
    }));
  }catch(err){target.innerHTML="";notify(niceError(err),"error");}
}
async function updateStatus(id,status,rejection_reason){
  try{
    const {error}=await db.from("submissions").update({status,rejection_reason,reviewed_by:currentUser.id,reviewed_at:new Date().toISOString()}).eq("id",id);
    if(error)throw error;
    notify(`Submission marked ${status}.`,"success");
    await loadFacultyRows();
  }catch(err){notify(niceError(err),"error");}
}
$("faculty-filter").addEventListener("change",loadFacultyRows);
$("section-filter").addEventListener("change",loadFacultyRows);
$("refresh-faculty").addEventListener("click",loadFacultyRows);
$("export-csv").addEventListener("click",()=>{
  const cols=[
    ["Student name",r=>r.profiles?.full_name],["Roll number",r=>r.profiles?.roll_number],["Section",r=>r.profiles?.section],
    ["Event",r=>r.event_name],["Event date",r=>r.event_date],["Type",r=>r.event_type],["Organiser",r=>r.organiser],
    ["Status",r=>r.status],["Rejection reason",r=>r.rejection_reason],["Submitted at",r=>r.created_at]
  ];
  const csvCell=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const csv=[cols.map(c=>csvCell(c[0])).join(","),...latestFacultyRows.map(r=>cols.map(c=>csvCell(c[1](r))).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8;"}));
  const a=document.createElement("a");a.href=url;a.download=`it-certificate-submissions-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
});

(async function init(){
  if(!isConfigured()||!window.supabase){
    show("setup-warning",true);showAuth(false);show("auth-panel",false);
    return;
  }
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  try{await refreshSession();}catch(err){notify(niceError(err),"error");showAuth("login");}
  db.auth.onAuthStateChange(async(_event,session)=>{
    currentUser=session?.user??null;
    if(!currentUser){currentProfile=null;showAuth("login");return;}
    try{await loadProfile();showApp();}catch(err){notify(niceError(err),"error");}
  });
})();
