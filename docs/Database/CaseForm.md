---
type: database-model
status: active
risk: high
---

# CaseForm

## Purpose
Case-specific government/application form copy and lifecycle root for versions, values, review, client requests, rendering, and signatures.

## Important Fields
Tenant/case/client/template/applicant links, title/form identifiers, status/source/requirement/copy type, storage metadata, current version, lock/representative/signature fields, and timestamps.

## Relationships
Belongs to [[Agency]], [[Case]], [[Client]], uploader and optional applicant/representative; owns versions, comments, permissions, field values, client/signature requests, and audits.

## Features and Services
[[Forms and Questionnaires]], [[Case Information]], [[Client Portal]], and [[Documents]]. Modified by case-form controllers and form/PDF/signature services.

## Deletion and Rules
Child form history commonly cascades with the form. Status, lock, field owner/fillability, version source, and representative identity constrain mutation and rendering; storage cleanup must accompany deletion.
