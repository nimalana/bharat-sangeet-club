# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Prospective members, families, collaborators, and concertgoers use the public site to understand Bharat Sangeet and experience its work.
- Club members use the private portal to follow announcements, dates, resources, recordings, photos, subgroups, and their own attendance.
- Executives and administrators use the portal to run meetings, attendance, finances, reimbursements, funding claims, membership, content, and permissions.

## Product Purpose

Bharat Sangeet is the shared digital home for UNC Chapel Hill's Indian classical music community. It combines a credible public presence with a practical operating workspace for the club. Success means visitors can understand the organization quickly, while members and leaders can complete recurring club work without hunting through disconnected tools.

## Positioning

One system connects the public identity of a university Indian classical music organization with its club-wide and subgroup operations. The workspace model keeps shared club activity and ensemble-specific work distinct without fragmenting the member experience.

## Operating Context

- Members frequently move between the whole-club workspace and one or more subgroup workspaces.
- Club operations include announcements, dates, documents, recordings, photos, attendance, finances, reimbursements, funding claims, member records, and administration.
- Attendance happens at full-group and subgroup meetings through short-lived check-in codes, executive review, and absence excuses.
- The experience must work for quick mobile check-ins as well as denser desktop administration.

## Capabilities and Constraints

- Preserve the existing product functions and role model while redesigning the entire public and private interface.
- Club-wide and subgroup scope must remain understandable and consistent.
- Members may belong to multiple subgroups; executives manage club operations and all subgroups; administrators additionally manage identities and permissions.
- Authorization remains enforced in Supabase and all database changes remain versioned migrations.
- Private member, subgroup, attendance, and finance information must not leak into public surfaces.
- Async actions need visible loading, disabled, success, error, and recovery states.

## Brand Commitments

- Keep the existing Carolina blue colors.
- Represent Carnatic and Hindustani traditions as equal parts of the club's Indian classical identity.
- Preserve subtle Indian classical music references through rhythm, notation, rehearsal culture, and performance; avoid decorative stereotypes or overpowering motifs.
- Retain the name “Bharat Sangeet at UNC Chapel Hill.”
- The redesign may replace the current visual system completely while keeping the product's content, functions, and recognizable identity.

## Evidence on Hand

- The repository README is the product roadmap and decision log.
- Existing public concert imagery and private club data provide real content structures.
- No testimonials, attendance statistics, financial claims, or other promotional proof should be invented.

## Product Principles

1. Make the current workspace and the next action immediately obvious.
2. Let members complete frequent tasks quickly, especially on mobile.
3. Give executives dense operational clarity without turning the interface into a generic admin dashboard.
4. Express Indian classical identity through restraint, rhythm, typography, and detail rather than themed decoration.
5. Keep public storytelling and private operations coherent but appropriately distinct.

## Accessibility & Inclusion

The redesign must support keyboard navigation, visible focus, readable contrast, screen-reader labels, touch-friendly controls, responsive layouts, reduced-motion preferences, and clear non-color status cues.
