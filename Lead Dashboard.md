You are working on an existing SaaS product called **CaseDesk**.

CaseDesk is a multi-tenant immigration agency CRM. We now need to build a complete production-ready **Lead Management System** from scratch inside the existing application.

Do not treat this as a simple lead table. This module must capture inquiries from every source, assign responsibility, track every interaction, enforce follow-ups, measure employee performance, identify lost leads, and safely convert successful leads into clients and cases.

## **Main business problem**

The agency receives leads from:

* Phone calls  
* Ooma  
* WhatsApp  
* Facebook  
* Instagram  
* Social-media lead forms  
* Social-media messages  
* Website forms  
* Google Ads  
* Email  
* Walk-ins  
* Referrals  
* Events  
* Personal employee phone calls  
* Existing spreadsheets

There is currently no reliable funnel.

The agency cannot clearly determine:

* Who handled a lead  
* When the lead was contacted  
* What the employee discussed  
* How many attempts were made  
* What the latest outcome was  
* When the employee should follow up  
* Which leads converted  
* Which leads were lost  
* Why leads were lost  
* Which employee converted the most leads  
* Which marketing source generated real clients  
* How quickly employees respond  
* Which leads are currently being ignored

The system must solve this completely.

## **Product principle**

Every inquiry must become a trackable record.

Every open lead must have:

* An agency  
* An owner  
* A current stage  
* A next action  
* A next-action date

Every interaction must have:

* An employee  
* A date and time  
* A communication channel  
* An outcome  
* Notes where required

Every closed lead must have:

* A final status  
* A clear outcome  
* A conversion record or lost reason

Use this operating rule throughout the system:

No open lead without an owner. No open lead without a next action. No closed lead without an outcome.

---

# **Existing technology stack**

Use the existing CaseDesk architecture unless repository inspection shows an established equivalent.

## **Frontend**

* React  
* Vite  
* Tailwind CSS  
* React Router

## **Backend**

* Node.js  
* Express

## **Database and authentication**

* Supabase Postgres  
* Supabase Auth  
* Prisma preferred for database access

## **Hosting**

* Vercel frontend  
* Render or Railway backend  
* Supabase database and storage

Do not introduce a different framework unless absolutely necessary.

---

# **Initial instructions**

Before making changes:

1. Inspect the entire repository.  
2. Identify the current frontend, backend, authentication, Prisma, routing, validation, and authorization patterns.  
3. Identify how authenticated users and their agencies are currently resolved.  
4. Identify existing tables for agencies, users, clients, cases, follow-ups, notes, payments, and activity logs.  
5. Identify reusable components, API utilities, error handling, form controls, dialogs, tables, filters, and pagination.  
6. Check existing migrations and database naming conventions.  
7. Check whether Supabase Row Level Security is already configured.  
8. Check whether background jobs already exist.  
9. Do not replace working architecture unnecessarily.  
10. Reuse existing conventions wherever they are secure and maintainable.

Before implementation, produce:

* A concise repository assessment  
* Existing files that will be reused  
* New files that will be created  
* Existing files that will be modified  
* Database migration plan  
* Security risks found  
* Implementation plan for the requested phase

Do not begin unrelated refactoring.

---

# **Multi-tenancy requirements**

CaseDesk uses one database for multiple agencies.

Every important lead-related table must include:

agency\_id

The backend must never trust an `agency_id` supplied by the frontend.

For authenticated CRM requests:

Supabase access token  
    ↓  
Backend verifies token  
    ↓  
Backend resolves active user membership  
    ↓  
Backend resolves trusted agency\_id  
    ↓  
All queries use that agency\_id

For public forms and platform webhooks:

Public token or connection token  
    ↓  
Backend resolves stored source connection  
    ↓  
Source connection resolves trusted agency\_id  
    ↓  
Incoming record is saved under that agency

Agency A must never access Agency B’s:

* Leads  
* Activities  
* Follow-ups  
* Consultations  
* Reports  
* Campaigns  
* Integrations  
* Incoming events  
* Conversions  
* Lost-lead records

Apply backend authorization to every endpoint.

Use Supabase Row Level Security as defence in depth where compatible with the existing architecture.

Create tenant-isolation tests.

---

# **Core lead lifecycle**

The complete lifecycle is:

Lead received  
    ↓  
Raw incoming event stored  
    ↓  
Payload validated  
    ↓  
Data normalized  
    ↓  
Duplicate detection  
    ↓  
New lead created or existing record updated  
    ↓  
Lead assigned  
    ↓  
First-contact deadline created  
    ↓  
Contact attempts recorded  
    ↓  
Lead connected  
    ↓  
Lead qualified  
    ↓  
Consultation booked  
    ↓  
Consultation completed  
    ↓  
Retainer follow-up  
    ↓  
Initial payment follow-up  
    ↓  
Lead converted into client and case

Alternative outcomes:  
Lost  
Nurture  
Duplicate  
Do Not Contact  
Archived

A lead must never silently disappear.

---

# **Lead statuses**

Use a final operational status separate from the current funnel stage.

Supported statuses:

OPEN  
CONVERTED  
LOST  
NURTURE  
DUPLICATE  
DO\_NOT\_CONTACT  
ARCHIVED

---

# **Lead stages**

Supported stages:

NEW  
ASSIGNED  
CONTACTING  
CONNECTED  
QUALIFIED  
CONSULTATION\_BOOKED  
CONSULTATION\_COMPLETED  
RETAINER\_PENDING  
PAYMENT\_PENDING  
READY\_TO\_CONVERT

Do not use the stage as the final status.

Every stage change must create an immutable stage-history record.

---

# **Priority and temperature**

Priority:

LOW  
NORMAL  
HIGH  
URGENT

Temperature:

COLD  
WARM  
HOT

Priority represents operational urgency.

Temperature represents likelihood of conversion.

---

# **Universal lead capture architecture**

Build one universal lead intake architecture rather than separate lead logic for every platform.

Website  
Meta  
WhatsApp  
Google  
Email  
Phone  
Walk-in  
Referral  
CSV  
    ↓  
Incoming event or manual intake  
    ↓  
Normalization  
    ↓  
Duplicate detection  
    ↓  
Lead creation or lead update

The system should eventually support:

* Website public forms  
* Facebook lead forms  
* Instagram lead forms  
* Facebook messages  
* Instagram messages  
* WhatsApp Business Platform  
* Google Ads lead forms  
* Email intake  
* Phone-provider webhooks  
* Ooma integration if API access is available  
* Manual Quick Add  
* Mobile Quick Add  
* QR-code intake  
* CSV import

Do not block the first release on third-party integrations.

Build the internal architecture first so connectors can be added later.

---

# **Manual and public lead intake**

## **Quick Add Lead**

Create a fast internal lead form available from the global header.

The minimum initial fields should be:

* Phone number  
* Name  
* Source  
* Immigration interest  
* Assigned employee  
* Next action  
* Next-action date

Phone and source should be required.

The form should be fast enough to complete during a live phone call.

## **Mobile Quick Add**

The internal form must be responsive and easy to use on a mobile browser.

## **Public intake form**

Create an agency-specific public intake form using a secure public token.

Example route:

/public/intake/:publicToken

Do not expose `agency_id`.

Suggested fields:

* First name  
* Last name  
* Phone  
* Email  
* Country  
* Preferred language  
* Current immigration status  
* Immigration service required  
* Message  
* Preferred contact time  
* Consent checkbox

Protect it using:

* Validation  
* Rate limiting  
* Bot protection or CAPTCHA-ready architecture  
* Public-token validation  
* Sanitization

Support source and campaign tracking through approved query parameters.

## **QR-code support**

The public intake URL must be usable for QR codes at:

* Reception  
* Events  
* Seminars  
* Printed marketing materials

## **CSV import**

Support importing existing leads from CSV.

The import flow should:

* Upload and parse CSV  
* Preview rows  
* Map columns  
* Validate each row  
* Normalize phone and email  
* Detect duplicates  
* Import valid rows  
* Report invalid rows  
* Report skipped duplicates  
* Preserve import batch information

---

# **Normalized lead input**

All connectors and forms should be transformed into one normalized internal structure.

Example:

{  
  "source": "WHATSAPP",  
  "sourceDetail": "Main Agency WhatsApp",  
  "externalId": "provider-record-id",  
  "firstName": "Raj",  
  "lastName": "Singh",  
  "phone": "+14165550123",  
  "email": null,  
  "immigrationInterest": "STUDY\_PERMIT",  
  "initialMessage": "I need help with a study permit",  
  "campaignId": null,  
  "receivedAt": "2026-07-14T15:30:00Z"  
}

Normalization must include:

* Phone numbers converted to E.164 where possible  
* Emails trimmed and lowercased  
* Names trimmed  
* Standard source values  
* Dates stored in UTC  
* Empty strings converted to null  
* Campaign information preserved  
* Provider-specific IDs preserved  
* Original raw payload retained for integration events

Use a reliable phone-number library rather than custom string manipulation.

---

# **Duplicate detection**

Do not create multiple lead records simply because one person contacted the agency through several platforms.

Use these matching signals:

1. Exact normalized phone number  
2. Exact normalized email  
3. Exact provider external ID  
4. Existing client phone or email  
5. Similar name combined with another matching field  
6. Manual review for uncertain matches

Possible outcomes:

NO\_MATCH  
EXISTING\_OPEN\_LEAD  
EXISTING\_CLIENT  
POSSIBLE\_DUPLICATE  
EXACT\_DUPLICATE\_EVENT

Behaviour:

* No match: create a new lead  
* Existing open lead: add activity to the existing lead  
* Existing converted client: attach communication to the client where appropriate  
* Possible duplicate: add to duplicate-review queue  
* Exact duplicate event: do not process twice

Do not create a strict database-level unique constraint on phone number because families may share numbers.

Provide a controlled lead-merge operation.

The merge must:

* Keep one primary lead  
* Transfer activities  
* Transfer follow-ups  
* Transfer consultations  
* Transfer external platform IDs  
* Transfer notes and tags  
* Preserve an audit trail  
* Mark the duplicate lead as merged or duplicate  
* Never silently delete historical records

---

# **Lead creation behaviour**

When a valid new lead is created, the backend should:

1. Generate a unique lead number.  
2. Set status to `OPEN`.  
3. Set stage to `NEW`.  
4. Record original source.  
5. Record source details and campaign.  
6. Store the initial message.  
7. Assign an employee or place it in the unassigned queue.  
8. Calculate first-contact deadline.  
9. Create the first next action.  
10. Create a lead-created activity.  
11. Create stage history.  
12. Create assignment history.  
13. Notify or surface it to the assigned employee.  
14. Add it to the dashboard.

Suggested lead-number format:

LD-2026-000451

Generate it safely without race conditions.

---

# **Assignment system**

Support:

## **Manual assignment**

A manager or authorized user selects an employee.

## **Round-robin assignment**

Distribute leads between active eligible employees.

## **Rule-based assignment**

Support future rules such as:

* Preferred language  
* Immigration service  
* Lead source  
* Campaign  
* Office or branch  
* Employee workload  
* Employee role  
* Lead priority  
* Seniority

Every assignment must create history containing:

* Previous owner  
* New owner  
* Assigned by  
* Assignment date  
* Assignment type  
* Reason  
* Whether it was automatic

If assignment fails:

* Do not lose the lead  
* Put it in an unassigned queue  
* Alert or surface it to managers

If an employee becomes inactive:

* Prevent new assignments  
* Reassign open leads and follow-ups through an authorized workflow

---

# **Response-time and SLA tracking**

Each agency should be able to configure a first-response target by source.

Example defaults:

Incoming call: immediate  
WhatsApp: 5 minutes  
Website: 10 minutes  
Facebook lead form: 10 minutes  
Instagram inquiry: 15 minutes  
Email: 30 minutes  
Referral: 1 hour  
Imported lead: same business day

Store:

* Lead received time  
* First-contact due time  
* First contact attempt  
* First successful connection  
* SLA status  
* Delay duration

Metrics:

* Time to first attempt  
* Time to first successful connection  
* On-time response  
* Late response  
* Never contacted

The response-time system must respect the agency’s configured timezone.

Database timestamps should remain UTC.

---

# **Lead activities and timeline**

Every important event must appear in one chronological lead timeline.

Supported activity types:

LEAD\_CREATED  
INCOMING\_CALL  
OUTGOING\_CALL  
MISSED\_CALL  
WHATSAPP\_RECEIVED  
WHATSAPP\_SENT  
SMS\_RECEIVED  
SMS\_SENT  
EMAIL\_RECEIVED  
EMAIL\_SENT  
INTERNAL\_NOTE  
STAGE\_CHANGED  
ASSIGNMENT\_CHANGED  
FOLLOW\_UP\_CREATED  
FOLLOW\_UP\_COMPLETED  
CONSULTATION\_BOOKED  
CONSULTATION\_RESCHEDULED  
CONSULTATION\_COMPLETED  
CONSULTATION\_CANCELLED  
CONSULTATION\_NO\_SHOW  
AGREEMENT\_PREPARED  
AGREEMENT\_SENT  
AGREEMENT\_SIGNED  
PAYMENT\_REQUESTED  
PAYMENT\_RECEIVED  
LEAD\_CONVERTED  
LEAD\_LOST  
LEAD\_MOVED\_TO\_NURTURE  
LEAD\_REACTIVATED  
LEAD\_MERGED

Every activity should support:

* Lead  
* Agency  
* Activity type  
* Direction  
* Channel  
* Outcome  
* Title  
* Description  
* Duration  
* Employee  
* Provider external ID  
* Occurred time  
* Created time  
* Metadata where appropriate

Historical activities should not be directly editable by normal employees.

Use corrections or additional activities rather than silently replacing history.

---

# **Call tracking**

The system must track daily employee calling activity.

Required call outcomes:

CONNECTED  
NO\_ANSWER  
VOICEMAIL\_LEFT  
CALLBACK\_REQUESTED  
INTERESTED  
NOT\_INTERESTED  
CONSULTATION\_BOOKED  
NOT\_ELIGIBLE  
WRONG\_NUMBER  
NUMBER\_UNAVAILABLE  
ALREADY\_USING\_ANOTHER\_CONSULTANT  
LANGUAGE\_ISSUE  
FOLLOW\_UP\_REQUIRED  
CONVERTED  
DO\_NOT\_CONTACT

After every manually recorded or integrated call, show a required outcome form.

Required fields:

* Call direction  
* Outcome  
* Employee  
* Date and time  
* Notes based on outcome  
* Next action for open leads  
* Next-action date for open leads

Call duration should be automatic when provided by a phone integration.

An employee must not be able to save a generic “call completed” without an outcome.

For Ooma:

* Create a provider abstraction  
* Do not assume unsupported public API access  
* Keep the system functional through manual call recording  
* Support future Ooma webhook/API access  
* Support call-log CSV import if needed  
* Keep Ooma-specific logic isolated from core lead logic

---

# **Next Action System**

Every open lead must display one clear next action.

Examples:

Call lead  
Send WhatsApp introduction  
Send consultation booking link  
Confirm consultation  
Follow up after consultation  
Send agreement  
Follow up on agreement  
Request initial payment  
Review qualification  
Mark as lost  
Reactivate later

Store:

next\_action\_type  
next\_action\_description  
next\_action\_at  
next\_action\_owner\_id

When an employee completes an action:

* Record a completed follow-up or activity  
* Ask for the outcome  
* Require a new next action if the lead remains open  
* Allow closure only through an approved final workflow

Dashboard queues must include:

* Due today  
* Overdue  
* Upcoming  
* No next action  
* Unassigned  
* Stale leads  
* SLA missed  
* New and uncontacted

---

# **Contact sequence**

Support configurable contact sequences.

Initial default example:

Step 1: immediate first call  
Step 2: WhatsApp or SMS after unanswered call  
Step 3: second call later the same day  
Step 4: third call next business day  
Step 5: follow-up message on day 3  
Step 6: final call on day 5  
Step 7: move to nurture or lost on day 7

For the first release, create employee tasks rather than automatically sending messages.

Design the data model so approved automated messaging can be added later.

Avoid uncontrolled spam.

---

# **Qualification**

After successful connection, allow the employee to record qualification information.

Suggested fields:

* Immigration service required  
* Current country  
* Current immigration status  
* Status-expiry date  
* Preferred destination  
* Education  
* Work experience  
* Language test  
* Previous refusals  
* Family status  
* Estimated budget  
* Preferred consultation time  
* Urgency  
* Notes  
* Eligibility confidence

Qualification outcome:

QUALIFIED  
MORE\_INFORMATION\_REQUIRED  
CONSULTATION\_REQUIRED  
NOT\_ELIGIBLE  
FUTURE\_OPPORTUNITY  
SERVICE\_NOT\_OFFERED

This module supports staff assessment but must not provide automated legal advice.

---

# **Consultation lifecycle**

A consultation record should support:

* Lead  
* Consultant  
* Start date and time  
* End date and time  
* Timezone  
* Appointment type  
* Location  
* Meeting URL  
* Fee  
* Payment status  
* Confirmation status  
* Reminder status  
* Outcome  
* Notes

Consultation statuses:

SCHEDULED  
CONFIRMED  
COMPLETED  
CANCELLED  
RESCHEDULED  
NO\_SHOW

After a completed consultation, require an outcome:

READY\_TO\_PROCEED  
AGREEMENT\_REQUIRED  
PAYMENT\_REQUIRED  
FOLLOW\_UP\_REQUIRED  
NOT\_ELIGIBLE  
NOT\_INTERESTED  
FUTURE\_OPPORTUNITY  
LOST

The consultation outcome should update the lead stage or next action through backend-controlled business logic.

---

# **Retainer and initial-payment tracking**

For the lead lifecycle, track agreement and initial-payment status.

Retainer statuses:

NOT\_REQUIRED  
NOT\_PREPARED  
PREPARED  
SENT  
VIEWED  
SIGNED  
DECLINED  
EXPIRED

Initial-payment statuses:

NOT\_REQUESTED  
REQUESTED  
PARTIAL  
PAID  
FAILED  
REFUNDED  
WAIVED

The first release may track these as statuses connected to the lead.

The architecture should allow future connection to full agreement, invoice, payment schedule, and accounting modules.

---

# **Conversion lifecycle**

A lead must only become a client through one controlled **Convert to Client** backend action.

Do not allow users to manually create a separate client and leave the lead open.

The conversion service must:

1. Verify the authenticated employee has permission.  
2. Verify the lead belongs to the employee’s agency.  
3. Verify the lead is open.  
4. Verify the lead has not already been converted.  
5. Validate required conversion information.  
6. Create a client.  
7. Create an initial case where appropriate.  
8. Copy contact information.  
9. Copy immigration interest.  
10. Copy important qualification information.  
11. Copy assigned consultant.  
12. Preserve original source and campaign.  
13. Preserve notes and timeline linkage.  
14. Create a conversion record.  
15. Link lead to client.  
16. Link lead to case.  
17. Set lead status to `CONVERTED`.  
18. Set conversion time and converted-by user.  
19. Close or cancel open lead follow-ups.  
20. Create a conversion activity.  
21. Create the first client or case next action.  
22. Write an audit log.

The entire conversion must run in one database transaction.

If any required part fails, roll back the complete conversion.

Prevent duplicate conversions through database constraints and backend checks.

---

# **Lost lead lifecycle**

A lead cannot be marked lost without a reason.

Suggested lost reasons:

NO\_RESPONSE  
NOT\_INTERESTED  
NOT\_ELIGIBLE  
PRICE\_CONCERN  
SELECTED\_ANOTHER\_CONSULTANT  
CONSULTATION\_NO\_SHOW  
AGREEMENT\_NOT\_SIGNED  
PAYMENT\_NOT\_COMPLETED  
SERVICE\_NOT\_OFFERED  
WRONG\_CONTACT\_INFORMATION  
DUPLICATE  
DO\_NOT\_CONTACT  
OTHER

Required information:

* Lost reason  
* Lost notes  
* Lost date  
* Lost by  
* Last-contact date  
* Number of attempts  
* Reactivation eligibility  
* Reactivation date if applicable

Allow agency configuration of lost reasons.

Allow managers to require approval before high-priority or high-value leads are marked lost.

---

# **Nurture and reactivation**

Use `NURTURE` when a lead may become valuable later.

Examples:

* Waiting for IELTS  
* Waiting for graduation  
* Waiting for status expiry  
* Saving money  
* Waiting for family documents  
* Planning a future intake

Store:

* Nurture reason  
* Reactivation date  
* Preferred contact method  
* Assigned employee  
* Notes

When the reactivation date arrives:

* Create a follow-up  
* Add the lead back to the employee queue  
* Create a reactivation activity  
* Notify or surface the item  
* Allow the lead to return to an open working stage

---

# **Lead dashboard**

Create a dedicated route:

/lead-dashboard

The dashboard must answer:

* What must be handled today?  
* Which leads are being ignored?  
* Which employees are completing their work?  
* Where are leads dropping out?  
* Which sources produce real clients?

## **Summary cards**

Include:

* New leads today  
* Uncontacted leads  
* SLA missed  
* Follow-ups due today  
* Overdue follow-ups  
* Consultations today  
* Converted this week  
* Lost this week  
* Open pipeline value  
* Overall conversion rate

## **Today’s Work**

Show an actionable table or queue with:

* Lead  
* Current issue  
* Source  
* Owner  
* Stage  
* Due time  
* Next action  
* Quick action button

## **Operational sections**

Include:

* New leads awaiting first contact  
* Leads without next action  
* Overdue follow-ups  
* Leads inactive for a configured number of days  
* Consultation no-shows  
* Retainer pending  
* Initial payment pending  
* Unassigned leads  
* Possible duplicates  
* Manager review required

## **Management sections**

Include:

* Funnel  
* Source performance  
* Employee performance  
* Lost-reason breakdown  
* Conversion trend  
* Average response time  
* Lead ageing  
* Workload distribution

Use clear loading, empty, error, and permission-denied states.

---

# **Lead list**

Create:

/leads

Include:

* Search  
* Server-side pagination  
* Sorting  
* Filters  
* Saved views if consistent with current architecture  
* CSV export if time allows  
* Clear empty states  
* Quick Add button

Recommended columns:

* Lead number  
* Lead name  
* Phone  
* Source  
* Immigration interest  
* Stage  
* Status  
* Temperature  
* Priority  
* Assigned employee  
* Last activity  
* Next action  
* Due date  
* Lead age

Filters:

* Source  
* Campaign  
* Stage  
* Status  
* Employee  
* Immigration interest  
* Temperature  
* Priority  
* Created date  
* Last-contact date  
* Next-action date  
* Lost reason  
* Unassigned  
* Overdue  
* SLA missed  
* Stale

Use query parameters so filters are shareable and restorable.

---

# **Lead profile**

Create:

/leads/:id

Use a professional CRM layout.

## **Header**

Display:

* Lead name  
* Lead number  
* Status  
* Stage  
* Source  
* Assigned employee  
* Priority  
* Temperature  
* Main quick actions

Quick actions:

* Call  
* Record activity  
* Add follow-up  
* Change stage  
* Assign  
* Book consultation  
* Convert  
* Move to nurture  
* Mark lost  
* Merge duplicate

## **Profile content**

Show:

* Contact information  
* Immigration interest  
* Qualification  
* Source and campaign  
* Assignment  
* Next action  
* First-response deadline  
* Last activity  
* Timeline  
* Calls  
* Messages  
* Notes  
* Follow-ups  
* Consultations  
* Retainer status  
* Initial-payment status  
* Stage history  
* Assignment history  
* Conversion or lost details

Do not overcrowd the page.

Use sections, tabs, or panels consistent with the existing CaseDesk UI.

---

# **Reports**

Create:

/lead-reports

Required reports:

## **Funnel report**

Show movement and drop-off across:

Received  
Contacted  
Connected  
Qualified  
Consultation booked  
Consultation completed  
Retainer pending  
Payment pending  
Converted

## **Employee report**

Show:

* Leads assigned  
* New leads handled  
* Contact attempts  
* Calls completed  
* Successful connections  
* No-answer calls  
* Follow-ups due  
* Follow-ups completed  
* Follow-ups overdue  
* Consultations booked  
* Consultations completed  
* Leads converted  
* Leads lost  
* Conversion rate  
* Average first-response time  
* Average connection time  
* Revenue converted where available

## **Source report**

Show:

* Leads received  
* Leads contacted  
* Qualified leads  
* Consultations  
* Converted clients  
* Lost leads  
* Conversion rate  
* Average response time  
* Estimated pipeline value  
* Actual conversion value  
* Main lost reasons

## **Lost-lead report**

Show:

* Lost leads by reason  
* Lost leads by employee  
* Lost leads by source  
* Lost after consultation  
* Lost after agreement  
* Lost after payment request  
* No-response leads  
* Reactivation opportunities

## **Response-time report**

Show:

* Average first-attempt time  
* Average connection time  
* SLA compliance  
* Leads never contacted  
* Late leads by employee  
* Late leads by source

All reports should support filters for:

* Date range  
* Employee  
* Source  
* Campaign  
* Immigration service  
* Stage  
* Status  
* Language  
* Branch if available

---

# **Metric definitions**

Use centralized metric definitions.

Do not calculate the same metric differently across endpoints.

Definitions:

First response time \=  
first contact attempt time \- lead created time

Connection time \=  
first successful connection time \- lead created time

Contact rate \=  
connected leads / leads with at least one attempt

Qualification rate \=  
qualified leads / connected leads

Booking rate \=  
consultations booked / qualified leads

Show rate \=  
completed consultations / booked consultations

Consultation conversion \=  
converted leads / completed consultations

Overall conversion \=  
converted leads / total valid leads

Lost rate \=  
lost leads / closed leads

Follow-up completion \=  
completed due follow-ups / total due follow-ups

SLA compliance \=  
leads contacted within target / leads requiring first contact

Average conversion time \=  
converted time \- created time

Exclude duplicates, spam, or invalid records consistently where appropriate.

Document the reporting rules.

---

# **Lead settings**

Create:

/lead-settings

Settings should support:

* Sources  
* Campaigns  
* Lost reasons  
* Lead stages if configurable  
* Response-time targets  
* Contact sequence  
* Assignment rules  
* Tags  
* Integration connections  
* Public intake link  
* QR-code access  
* Employee assignment eligibility

Do not allow configuration that breaks required system states.

---

# **Database design**

Adapt naming to current repository conventions.

Create or extend these entities.

## **leads**

Required fields should include:

id  
agency\_id  
lead\_number  
first\_name  
last\_name  
phone  
phone\_normalized  
email  
email\_normalized  
country  
province  
preferred\_language  
current\_immigration\_status  
immigration\_interest  
status  
stage  
priority  
temperature  
owner\_user\_id  
original\_source\_id  
campaign\_id  
initial\_message  
estimated\_value  
next\_action\_type  
next\_action\_description  
next\_action\_at  
next\_action\_owner\_id  
first\_contact\_due\_at  
first\_contact\_at  
first\_connected\_at  
last\_contact\_at  
retainer\_status  
initial\_payment\_status  
converted\_client\_id  
converted\_case\_id  
converted\_at  
lost\_at  
nurture\_until  
version  
created\_at  
updated\_at  
deleted\_at

Use optimistic concurrency where useful.

## **lead\_sources**

id  
agency\_id  
name  
type  
is\_active  
created\_at  
updated\_at

## **campaigns**

id  
agency\_id  
name  
source\_id  
external\_id  
start\_date  
end\_date  
budget  
is\_active  
created\_at  
updated\_at

## **source\_connections**

id  
agency\_id  
provider  
name  
external\_account\_id  
encrypted\_credentials  
webhook\_secret  
public\_token  
status  
last\_sync\_at  
last\_error  
created\_at  
updated\_at

Do not expose credentials through API responses.

## **lead\_external\_ids**

id  
agency\_id  
lead\_id  
connection\_id  
provider  
external\_id  
created\_at

Use a unique constraint on:

agency\_id  
connection\_id  
external\_id

## **incoming\_events**

id  
agency\_id  
connection\_id  
provider  
external\_event\_id  
event\_type  
raw\_payload  
processing\_status  
retry\_count  
error\_message  
received\_at  
processed\_at  
created\_at

Use idempotency constraints.

## **lead\_activities**

id  
agency\_id  
lead\_id  
activity\_type  
direction  
channel  
outcome  
title  
description  
duration\_seconds  
performed\_by  
external\_id  
metadata  
occurred\_at  
created\_at

## **lead\_stage\_history**

id  
agency\_id  
lead\_id  
previous\_stage  
new\_stage  
changed\_by  
reason  
created\_at

## **lead\_assignment\_history**

id  
agency\_id  
lead\_id  
previous\_owner\_id  
new\_owner\_id  
assigned\_by  
assignment\_type  
reason  
created\_at

## **lead\_follow\_ups**

id  
agency\_id  
lead\_id  
assigned\_user\_id  
type  
description  
due\_at  
status  
completed\_at  
completed\_by  
completion\_outcome  
created\_at  
updated\_at

Follow-up statuses:

PENDING  
COMPLETED  
OVERDUE  
CANCELLED

Do not rely only on stored `OVERDUE`; calculate or synchronize it safely.

## **lead\_qualifications**

Store qualification information separately if it would make the lead table too large.

## **consultations**

id  
agency\_id  
lead\_id  
consultant\_user\_id  
start\_at  
end\_at  
timezone  
appointment\_type  
status  
fee  
payment\_status  
confirmation\_status  
location  
meeting\_url  
outcome  
notes  
created\_at  
updated\_at

## **lead\_conversions**

id  
agency\_id  
lead\_id  
client\_id  
case\_id  
converted\_by  
estimated\_value  
actual\_value  
converted\_at  
created\_at

Use one conversion per lead.

## **lead\_lost\_details**

id  
agency\_id  
lead\_id  
reason\_code  
notes  
lost\_by  
reactivation\_allowed  
reactivation\_at  
created\_at

## **lead\_tags**

## **lead\_tag\_assignments**

## **assignment\_rules**

## **response\_time\_rules**

## **contact\_sequence\_rules**

## **import\_batches**

## **import\_rows**

## **audit\_logs**

Reuse existing generic tables where suitable.

---

# **Backend APIs**

Use existing backend conventions.

Suggested routes:

POST   /api/leads  
GET    /api/leads  
GET    /api/leads/:id  
PATCH  /api/leads/:id

POST   /api/leads/:id/assign  
POST   /api/leads/:id/change-stage  
POST   /api/leads/:id/activities  
POST   /api/leads/:id/follow-ups  
POST   /api/leads/:id/qualify  
POST   /api/leads/:id/book-consultation  
POST   /api/leads/:id/convert  
POST   /api/leads/:id/mark-lost  
POST   /api/leads/:id/move-to-nurture  
POST   /api/leads/:id/reactivate  
POST   /api/leads/:id/merge

PATCH  /api/lead-follow-ups/:id  
POST   /api/lead-follow-ups/:id/complete  
POST   /api/lead-follow-ups/:id/cancel

GET    /api/lead-dashboard

GET    /api/lead-reports/funnel  
GET    /api/lead-reports/sources  
GET    /api/lead-reports/employees  
GET    /api/lead-reports/lost-reasons  
GET    /api/lead-reports/response-times  
GET    /api/lead-reports/ageing

POST   /api/lead-imports  
GET    /api/lead-imports/:id

GET    /api/lead-settings  
PATCH  /api/lead-settings

Public and webhook endpoints:

POST /api/public/intake/:publicToken  
POST /api/webhooks/meta/:connectionToken  
POST /api/webhooks/whatsapp/:connectionToken  
POST /api/webhooks/google/:connectionToken  
POST /api/webhooks/phone/:connectionToken  
POST /api/webhooks/email/:connectionToken

Public tokens must resolve agency and connection server-side.

---

# **Validation**

Use centralized schemas.

Validate:

* Phone  
* Email  
* Dates  
* Enums  
* Required outcomes  
* Required next action  
* Allowed stage transitions  
* Allowed status transitions  
* Conversion requirements  
* Lost-reason requirements  
* Nurture-date requirements  
* Assignment eligibility  
* Public-form limits  
* CSV row values

Never trust frontend validation alone.

---

# **Authorization**

Suggested roles:

## **Admin**

* All agency leads  
* All reports  
* Settings  
* Integrations  
* Assignment rules  
* Merge  
* Export  
* Reassignment  
* Employee management

## **Manager**

* Team leads  
* Team reports  
* Reassignment  
* Duplicate review  
* Lost-lead approval  
* Workload review

## **Consultant**

* Assigned leads  
* Activities  
* Follow-ups  
* Qualification  
* Consultations  
* Conversion where authorized

## **Reception or Lead Agent**

* Create leads  
* Contact assigned leads  
* Record outcomes  
* Schedule consultations  
* Limited client-case access

Check permissions in backend services and controllers.

Do not rely only on frontend route protection.

---

# **Incoming event reliability**

For platform events:

1. Verify provider signature where available.  
2. Resolve connection securely.  
3. Store raw event.  
4. Check idempotency.  
5. Queue processing.  
6. Respond quickly.  
7. Normalize asynchronously.  
8. Detect duplicates.  
9. Create or update the lead.  
10. Store processing outcome.  
11. Retry temporary failures.  
12. Preserve permanently failed events for review.

If the project has no queue, use a PostgreSQL-backed job system such as `pg-boss`, unless repository architecture suggests a better existing solution.

Suggested jobs:

process-incoming-event  
assign-new-lead  
check-first-response-sla  
mark-overdue-follow-ups  
send-follow-up-reminders  
reactivate-nurture-leads  
detect-stale-leads  
sync-provider-events  
recalculate-lead-metrics

Do not make webhook requests wait for long processing.

---

# **Security**

Implement:

* Verified authentication  
* Tenant isolation  
* Backend authorization  
* RLS defence in depth  
* Rate limiting  
* Secure webhook secrets  
* Signature verification  
* Replay protection  
* Idempotency  
* Sanitization  
* Secure headers  
* HTTPS assumptions  
* Encrypted provider credentials  
* Masked logs  
* Audit logs  
* Soft deletion  
* Safe error responses  
* No secret values in frontend code  
* No service-role keys exposed to clients  
* No cross-agency IDs accepted without ownership verification

Do not log raw access tokens or integration secrets.

Be cautious about logging full personal information.

---

# **Audit logging**

Create audit records for:

* Lead creation  
* Lead update  
* Assignment  
* Stage change  
* Status change  
* Conversion  
* Lost action  
* Reactivation  
* Merge  
* Export  
* Settings changes  
* Integration changes  
* Manual deletion or archive  
* Permission failure where appropriate

Audit logs should include:

* Agency  
* User  
* Action  
* Entity  
* Entity ID  
* Before and after data where appropriate  
* Timestamp  
* Request information where safe

---

# **Frontend structure**

Follow existing repository structure.

A possible module structure is:

frontend/src/modules/leads/  
  api/  
  components/  
  hooks/  
  pages/  
  validation/  
  utils/

Suggested components:

LeadSummaryCards  
TodayWorkTable  
LeadTable  
LeadFilters  
LeadSearch  
LeadProfileHeader  
LeadContactPanel  
LeadTimeline  
LeadActivityForm  
CallOutcomeDialog  
NextActionCard  
FollowUpDialog  
AssignmentDialog  
StageChangeDialog  
QualificationForm  
ConsultationDialog  
ConversionDialog  
LostLeadDialog  
NurtureDialog  
DuplicateReviewDialog  
LeadSourceBadge  
LeadStageBadge  
LeadStatusBadge  
EmployeePerformanceTable  
LeadFunnelChart  
SourcePerformanceTable

Reuse existing design-system components.

Use accessible forms and dialogs.

---

# **Backend structure**

Follow existing module conventions.

A possible structure is:

backend/src/modules/leads/  
  lead.controller  
  lead.service  
  lead.repository  
  lead.routes  
  lead.validation  
  lead.permissions  
  lead.constants

backend/src/modules/lead-intake/  
  intake.controller  
  intake.service  
  normalization.service  
  deduplication.service  
  assignment.service

backend/src/modules/lead-reporting/  
  reporting.controller  
  reporting.service

backend/src/modules/integrations/  
  meta/  
  whatsapp/  
  google/  
  phone/  
  email/

backend/src/jobs/  
  lead.jobs

Do not force this exact structure if the repository has a clear established architecture.

---

# **Performance**

Use:

* Server-side pagination  
* Indexed filtering  
* Indexed agency ownership  
* Indexed owner and next-action fields  
* Indexed stage and status  
* Indexed source and campaign  
* Indexed normalized phone and email  
* Efficient reporting queries  
* Selective data loading  
* Avoid N+1 queries  
* Transaction-safe writes

Recommended composite indexes should include combinations such as:

agency\_id \+ status  
agency\_id \+ stage  
agency\_id \+ owner\_user\_id  
agency\_id \+ next\_action\_at  
agency\_id \+ created\_at  
agency\_id \+ phone\_normalized  
agency\_id \+ email\_normalized  
agency\_id \+ original\_source\_id  
agency\_id \+ campaign\_id

Confirm indexes using actual query patterns.

---

# **Failure handling**

Required behaviours:

## **Duplicate webhook**

Process only once.

## **Integration temporarily unavailable**

Store event and retry.

## **Assignment fails**

Put lead in unassigned queue.

## **Employee inactive**

Use fallback assignment or manager queue.

## **Conversion fails**

Roll back entire transaction.

## **Connection credentials expire**

Mark connection unhealthy and notify admin.

## **Public-form spam**

Rate-limit and flag.

## **Follow-up owner removed**

Reassign open work.

## **Cross-agency access attempt**

Return forbidden and create a security-relevant log where appropriate.

## **Report query fails**

Show a safe error state without breaking operational lead work.

---

# **Tests**

Add meaningful tests.

## **Unit tests**

* Normalization  
* Phone and email matching  
* Duplicate detection  
* Stage transition rules  
* Status transition rules  
* SLA calculation  
* Next-action enforcement  
* Metric formulas  
* Assignment selection  
* Lost and nurture validation

## **Integration tests**

* Create lead  
* Assign lead  
* Record call  
* Complete follow-up  
* Book consultation  
* Mark lost  
* Move to nurture  
* Reactivate  
* Convert to client  
* Merge duplicate  
* Public intake  
* Idempotent incoming event

## **Security tests**

* Agency A cannot read Agency B lead  
* Agency A cannot update Agency B lead  
* Employee cannot access unauthorized lead  
* Public token resolves only its agency  
* Webhook token cannot select another agency  
* Frontend-supplied agency ID is ignored  
* Invalid signature is rejected

## **Transaction tests**

* Failed conversion creates no partial client or case  
* Failed merge preserves original records  
* Duplicate conversion is rejected

Do not mock away the core tenant and transaction behaviour.

---

# **Seed data**

Add realistic Canadian immigration lead data.

Use services such as:

* Study Permit  
* Work Permit  
* Visitor Visa  
* Express Entry  
* PNP  
* LMIA  
* Spousal Sponsorship  
* PGWP  
* Citizenship

Create realistic leads in different states:

* New uncontacted Facebook lead  
* WhatsApp lead requiring callback  
* Referral with consultation booked  
* Website lead marked qualified  
* Consultation no-show  
* Retainer pending  
* Initial payment pending  
* Converted lead  
* Lost due to price  
* Lost due to no response  
* Nurture lead waiting for IELTS  
* Possible duplicate  
* Overdue follow-up  
* SLA-missed lead

Use realistic Canadian names, phone-number placeholders, dates, employees, and sources.

Do not use real personal information.

---

# **User experience principles**

The module is for non-technical office staff.

Keep it:

* Clean  
* Professional  
* Fast  
* Easy to understand  
* Action-oriented  
* Minimal in unnecessary clicks  
* Clear about ownership  
* Clear about deadlines  
* Clear about outcomes

Avoid:

* Flashy animations  
* Overcomplicated charts  
* Deeply nested forms  
* Hidden critical actions  
* Unexplained statuses  
* Large modal forms when a focused panel is better

Use strong empty states and useful error messages.

The most important item should always be:

What does this employee need to do next?

---

# **Production readiness checklist**

The module is not complete until it has:

* Database migration  
* Tenant-safe queries  
* Authorization  
* Validation  
* Error handling  
* Loading states  
* Empty states  
* Audit logging  
* Tests  
* Seed data  
* Indexes  
* Transaction handling  
* Idempotency  
* Public endpoint security  
* Documentation  
* Migration instructions  
* Environment variable documentation  
* API documentation  
* No exposed secrets  
* No placeholder critical logic  
* No unfinished TODOs in core workflows

---

# **Implementation phases**

Do not implement the whole system in one uncontrolled pass.

Work in these phases.

## **Phase 1 — Foundation**

Implement:

* Prisma schema  
* Migrations  
* Lead enums  
* Leads  
* Lead sources  
* Activities  
* Stage history  
* Assignment history  
* Follow-ups  
* Lost details  
* Conversions  
* Tenant-safe repository and services  
* Authorization foundation  
* Validation foundation  
* Audit integration  
* Seed data  
* Core tests

Do not build external integrations in this phase.

## **Phase 2 — Core lead operations**

Implement:

* Lead list  
* Lead profile  
* Quick Add  
* Search  
* Filters  
* Pagination  
* Assignment  
* Stage changes  
* Activity timeline  
* Call outcomes  
* Next Action System  
* Follow-up queue  
* Lost workflow  
* Nurture workflow  
* Reactivation  
* Duplicate review and merge

## **Phase 3 — Consultation and conversion**

Implement:

* Qualification  
* Consultation lifecycle  
* Retainer status  
* Initial-payment status  
* Transaction-safe conversion  
* Client and case linkage  
* Conversion tests

## **Phase 4 — Dashboard and reports**

Implement:

* Lead dashboard  
* Today’s Work  
* SLA monitoring  
* Employee reporting  
* Source reporting  
* Funnel reporting  
* Lost-reason reporting  
* Lead ageing  
* Central metric definitions

## **Phase 5 — Universal intake**

Implement:

* Public intake form  
* Public intake endpoint  
* QR-ready URL  
* CSV import  
* Import preview  
* Import validation  
* Incoming events  
* Normalization  
* Duplicate detection  
* Background processing

## **Phase 6 — External integrations**

Implement separately:

1. Website connectors  
2. Meta lead forms  
3. WhatsApp Business  
4. Google Ads lead forms  
5. Email intake  
6. Ooma or another phone provider

Each connector must use the universal intake pipeline.

## **Phase 7 — Production hardening**

Complete:

* RLS  
* Tenant-isolation tests  
* Rate limiting  
* Webhook verification  
* Retry handling  
* Dead-letter handling  
* Monitoring  
* Logging  
* Database indexes  
* Backup documentation  
* Load testing  
* Security review  
* Deployment configuration

---

# **Required working method**

Only implement the currently requested phase.

For each phase:

1. Inspect relevant existing code.  
2. State assumptions.  
3. Provide a concrete file plan.  
4. Implement complete files rather than vague snippets.  
5. Use migrations instead of manually changing production data.  
6. Add tests with the implementation.  
7. Run available linting, type checking, tests, and builds.  
8. Fix errors caused by the changes.  
9. Report exactly what was changed.  
10. Report commands required to run migrations and seeds.  
11. Report any remaining limitations honestly.  
12. Do not begin the next phase automatically.

Do not overbuild.

Do not add AI qualification, WhatsApp automation, payment gateway, full accounting, or complex marketing attribution unless the current phase requests it.

Focus on a reliable production foundation.

---

# **Current task**

Start with **Phase 1 — Foundation only**.

First inspect the repository and produce:

* Repository assessment  
* Existing architecture summary  
* Security assessment  
* Database migration plan  
* Exact file plan  
* Implementation sequence

Then implement the Phase 1 foundation.

Phase 1 must result in a secure and expandable backend foundation that later phases can use without redesigning the database or tenant model.

