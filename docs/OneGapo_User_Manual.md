OneGapo User Manual
====================

Version: 1.0
Date: 2026-05-19

Table of contents
- Resident Guide
- Staff Guide
- Admin Guide
- Installer / Developer Appendix
- Glossary

---

# Resident Guide

## Overview
OneGapo is a citizen reporting and tracking system for local issues. Residents can register, report problems, attach photos or video, follow up on ticket statuses, and manage their profile.

## Quick Start
- Create account: Go to Sign up and provide Full name, Email, Contact number (Philippine mobile: `09XXXXXXXXX` or `+639XXXXXXXXX`), Address, Password (minimum 8 characters), confirm password, accept Terms & Privacy, then Create account. Verify your email when prompted.
- Sign in: Use Email + Password. Use Forgot password to request a reset email.

## Dashboard / Home
### Report an Issue
1. Click New Report or Submit Report.
2. Enter Title (min 5 characters), choose Category, write Description (min 20 characters).
3. Pin location on the map or use current location. Ensure location is within Olongapo City bounds.
4. Attach up to 3 images or videos if available.
5. Submit; you'll receive a success message and the report is listed in My submitted reports.

### Report Statuses
- Submitted
- In review
- Resolved
- Rejected
- Archived

Ticket details show audit trail updates, resolution notes, and attached resolution images when resolved.

## Notifications
Use the Notifications bell to see updates on your reports. The unread count appears on the bell icon.

## Profile & Settings
- Access Settings from the top bar or menu.
- Editable fields: Full name, Phone number, Home address.
- Save changes to update Firestore user profile and Firebase displayName.
- Email verification status shows Verified or Not verified. You can resend verification when available.
- Password reset: Send a reset email from Settings → Password and Recovery.
- Logout: Use Settings → Log out or Sign out in the top nav. A confirmation modal asks “Are you sure you want to log out?” — confirm to proceed.

## Maps & Location
- Pinning an incorrect location outside the allowed bounds will prevent submission and show a warning modal.

## Best Practices
- Provide clear titles and detailed descriptions.
- Include landmarks and photos when possible.
- Keep contact number and address updated in Settings.

## Troubleshooting & FAQ
- Cannot submit: Check network, required fields, and that the map location (if provided) is valid.
- Didn't receive verification/reset email: Check spam; if email delivery is not configured, contact admin.
- Session expired: Sign out and sign in again.

## Privacy & Security
User email, phone, and address are stored in Firestore user profiles. Verification state is managed via backend tokens and mirrored into custom claims.

---

# Staff Guide

## Overview
Staff users process resident reports, update statuses, forward tickets to other branches, and add progress notes. Staff permissions are assigned by Admins and scoped to branches.

## Getting Started
- Sign in using staff credentials provided by Admin. New staff may receive a password reset email to set their password.
- Role and permissions determine which actions (view_reports, update_reports, close_reports, archive_reports, forward) you can perform.

## Workspace Overview
- Reports List: Filter by status, category, date, or assigned branch.
- Ticket Details: View description, attachments, map pin, and audit trail.
- Update Workflow: Add progress notes, change status, attach resolution photos, and resolve or reject tickets.
- Forwarding: Forward tickets to other branches when needed; a forwarding audit entry is created.

## Settings & Profile
- Update Full name, Phone, and Address in Settings.
- Logout uses a confirmation modal to prevent accidental sign-out.

## Troubleshooting
- Missing updates: Refresh or check realtime connection.
- Permission issues: Contact Admin to update your role or custom permissions.

---

# Admin Guide

## Overview
Admins manage branches, staff, roles/permissions, and user accounts. Admin actions modify custom claims and Firestore user documents.

## Users Management
- Create staff or admin accounts via Admin → Create Staff (email, role, branchId, optional customRoleId). New staff receives an email for verification or password reset.
- Update user accounts (role, branch assignment, permissions) via Admin UI or API (`PATCH /api/admin/users/:uid`).
- Delete users; primary admin cannot be deleted.

## Branches & Roles
- Manage branches and assign staff to branches.
- Create custom roles with permission sets and assign them to users.

## Verification & Email
- The backend sends verification emails; verify that SMTP credentials are configured.
- If email delivery is not configured, the backend will mark delivery as skipped and return explanatory messages.

## Reports & Moderation
- View all reports, filter by branch and status, apply bulk actions if provided, and archive or delete reports.

## API Reference (selected)
- `POST /api/admin/create-staff` — create staff (email, password, role, branchId, customRoleId)
- `GET /api/admin/users` — list users
- `PATCH /api/admin/users/:uid` — update role, branchId, customRoleId
- `POST /api/admin/users/:uid/resend-verification` — resend verification
- `DELETE /api/admin/users/:uid` — delete user
- `POST /api/auth/complete-registration` — assign resident claim and write Firestore user doc (used by frontend after signup)

## Security & Claims
Custom claims include: `role`, `branchId`, `location`, `entityType`, `permissions`, `verified`.
Preserve least privilege when assigning permissions.

---

# Installer / Developer Appendix

## Project Layout
- `frontend/` — React + Vite frontend
  - `src/pages/` — page components
  - `src/components/` — shared components
  - `src/context/` — `AuthContext`, `SettingsModalContext`
- `backend/` — Express REST API using Firebase Admin SDK
  - `controllers/`, `routes/`, `services/`
- `realtime/` — socket server for live updates

## Environment & Setup
- Required services: Firebase project (Auth, Firestore), SMTP (for verification), Cloudinary (optional) for media.
- Local run:
  - Backend: cd `backend/`; install deps; set env vars; run `node index.js`.
  - Frontend: cd `frontend/`; `npm install`; `npm run dev`.

## Developer Notes
- Profile data stored in Firestore `users` collection keyed by `uid`.
- Signup Flow: Client creates Firebase Auth user, sets displayName, then calls `POST /api/auth/complete-registration` with contact and address. Backend sets custom claim `role: resident` and writes Firestore user doc with phone and address.
- Settings: `SettingsContent.jsx` reads/writes Firestore `users` doc and updates Firebase Auth `displayName`.

## Extending & Testing
- Add backend-side phone validation to match frontend PH-format if desired.
- Run backend with verbose logs to debug email delivery.

---

# Glossary
- Resident: A citizen who registers and files reports.
- Staff: Local government staff assigned to branches to process reports.
- Admin: High privilege user managing branches, staff, roles.
- Branch: Administrative unit or location context assigned to staff.
- Custom Claims: Firebase Auth custom claims representing role and permissions.

---

# Support
Contact the primary admin or system owner for operational issues and SMTP configuration.
