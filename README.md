# Secure VCE IT Student Certificate Portal

This version uses:
- Static website hosted on Vercel
- Supabase Auth (email + password)
- Supabase Postgres with Row Level Security (RLS)
- Private Supabase Storage bucket for certificate files
- Student submission history
- Faculty approve/reject workflow
- CSV export from the faculty view

## Before you begin

This is a starter implementation, not an institutionally audited production system. Use a college-approved account policy, review the SQL and privacy requirements with your IT administrator, and test with fictional records first. Never place a Supabase `service_role` or secret key in `app.js`, GitHub, or the browser.

## 1. Create a Supabase project

1. Visit https://supabase.com/dashboard and create a project.
2. Save the database password securely. Do not share it in chat or commit it to GitHub.
3. Wait for the project to finish provisioning.

## 2. Create database and storage policies

1. In Supabase, open **SQL Editor**.
2. Create a new query.
3. Copy the complete contents of `supabase/schema.sql` into the editor.
4. Run it and check for errors.

The script creates a private `certificates` bucket, tables, and RLS policies. If the project already has tables/policies with the same names, review carefully before running.

## 3. Configure the website

1. In Supabase, open **Project Settings > API** (the exact navigation may vary).
2. Copy the **Project URL** and the **publishable key** (or legacy `anon` key).
3. Open `app.js`.
4. Replace:
   - `PASTE_YOUR_SUPABASE_PROJECT_URL_HERE`
   - `PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE`
5. Save the file.

Only the publishable/anon key belongs in the browser. Never use a `service_role`, secret, or database password here.

## 4. Upload the website to GitHub

Upload these items to the root of your GitHub repository:
- `index.html`
- `styles.css`
- `app.js`
- `README.md`
- `supabase/schema.sql` (inside a `supabase` folder)

Commit the changes. Vercel should redeploy automatically if your repository is connected.

In Vercel, use Framework Preset **Other**, leave Build Command blank, and set Output Directory to `.`.

## 5. Create a faculty account securely

1. Open the deployed website and use **Student registration** with the faculty member's approved email and a strong password. This initially creates a student-role profile.
2. Confirm the email if Supabase email confirmation is enabled.
3. In Supabase SQL Editor, run this query after replacing the email with the exact faculty email:

```sql
update public.profiles
set role = 'faculty'
where id = (
  select id from auth.users
  where email = 'approved.faculty@your-college.edu'
);
```

4. Sign out and sign in again. The faculty dashboard should appear.

Only an authorised administrator should assign faculty roles. Do not give students SQL Editor access.

## 6. Student use

Students register with their college-approved email, name, roll number, and section. They confirm their email if required, sign in, and upload a PDF/JPG/PNG certificate (up to 5 MB). Their submission status appears in their account.

## 7. Security and operational checks before real use

- Use only college-approved email addresses and establish a process to verify student identity. This starter form does not independently verify that a roll number belongs to the person registering.
- Consider restricting sign-up to the college email domain in Supabase Auth and add additional verification/approval for new accounts.
- Verify RLS by testing two student accounts and a faculty account: students must not see each other's records; only faculty should see and review all submissions.
- Keep certificates in the private bucket. Do not make the bucket public.
- Configure email confirmation, password reset, backups, retention, consent, and incident handling according to college policy.
- Review current Supabase free-tier limits and inactivity rules. Free tiers and terms can change.
- For official deployment, have the college IT/security team review the implementation and applicable privacy obligations.

## Troubleshooting

- **Setup required message:** URL/key in `app.js` is not filled in correctly.
- **Email confirmation:** confirm the registration email, then sign in.
- **No faculty dashboard:** check the role update in `public.profiles`, then sign out/in.
- **Row Level Security error:** confirm `schema.sql` ran successfully and the account has the intended role.
- **File upload denied:** confirm the private bucket and storage policies were created.
- **Foreign key relation error in faculty table:** Supabase may require reloading schema cache after the SQL setup; verify the `submissions_student_id_fkey` relationship exists.

## Deployment URL

Current prototype URL: https://vce-it-student-achievements.vercel.app/
