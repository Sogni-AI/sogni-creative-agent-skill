# Sogni Creative Agent — OpenAI plugin submission plan

Created: 2026-09-30 (SGT, UTC+8)

Status: Planning; implementation and submission have not started.

Last updated: 2026-09-30

## Objective

Publish an official **Sogni Creative Agent** plugin in the shared ChatGPT/Codex directory. The recommended architecture is one plugin containing focused skills and a hosted MCP integration, with a small first release.

This document preserves the proposed plan. Feature scope, ownership, and estimates below are recommendations to confirm during implementation. Recheck OpenAI's requirements before submitting; the cited requirements were reviewed on September 30, 2026.

## Resume here

- [ ] Confirm the first-release scope and publishing organization.
- [ ] Assign the engineering and submission owners.
- [ ] Complete the account connection, media transfer, and generation feasibility pass described in milestone 2.
- [ ] Record the findings and estimate the remaining implementation.

**Next concrete outcome:** a fresh user can connect a Sogni account, generate an image, and receive the result in ChatGPT and Codex.

## Starting point

- The repository already contains a [Codex plugin manifest](../../.codex-plugin/plugin.json) and reusable [skills](../../skills/).
- The existing [MCP server](../../desktop-extension/server/index.mjs) invokes the local CLI. Its [tool definitions](../../desktop-extension/server/tools.mjs) are a starting point for the public tool design.
- In `Sogni-AI/sogni-api`, `src/routes/creative-workflow.route.ts` exposes durable workflow creation, status, events, cancellation, and cost confirmation. Evaluate these services for reuse.
- The existing local installation uses a Sogni API key. Public account linking needs a separate compatibility assessment and OAuth implementation or integration.
- Google/Apple sign-in support alone does not establish an MCP authorization server.
- The checked manifest's subtitle is 47 characters; OpenAI's current submission limit is 30. It also needs the relevant listing URLs and icon assets.

These observations come from the source reviewed during planning, not a live qualification of the public integration. Verify the current code and active model registry when work resumes.

## Suggested ownership

| Area | Proposed owner |
| --- | --- |
| Positioning, publisher verification, launch timing | Mauvis |
| Architecture and deployment approval | Mark |
| OAuth, hosted tools, media delivery, reliability | Engineering owner to assign |
| Skills, package, listing, test evidence | Engineering/submission owner to assign |
| Review feedback and ongoing support | Owner to assign |

## Milestone 1 — Define the first release and submission identity

- [ ] Confirm these five launch workflows:
  - Generate an image.
  - Edit an uploaded image.
  - Animate an uploaded image.
  - Animate between two uploaded images.
  - Generate music.
- [ ] Select supported models and concrete settings from the active registry.
- [ ] Define expected inputs, outputs, and limitations for each workflow.
- [ ] Treat 3D and uploaded-image reels as follow-up scope unless explicitly included in the first release.
- [ ] Select the OpenAI organization and project that will own the plugin.
- [ ] Complete business verification for the Sogni publishing identity.
- [ ] Ensure the submission owner has the required Apps Management permissions.
- [ ] Agree on the product description and three starter prompts.
- [ ] Include MCP in the initial submission package.

**Completion criteria:** agreed feature list, supported settings, publisher identity, submission owner, and starter prompts.

**Dependency:** OpenAI currently cannot add MCP to an existing skills-only listing. Choose the architecture before creating the public submission. See the [submission guide](https://developers.openai.com/plugins/deploy/submission).

## Milestone 2 — Prove account connection and one complete generation

- [ ] Assess which existing Sogni authentication components can be reused.
- [ ] Choose the hosted endpoint and authorization-server architecture.
- [ ] Implement or integrate OAuth 2.1 with PKCE and the required discovery metadata.
- [ ] Define narrow permissions and validate token issuer, audience, scope, expiry, and account identity.
- [ ] Keep authentication on Sogni's website; do not ask users to paste API keys or passwords into chat.
- [ ] Implement account disconnect/revocation and test reauthorization.
- [ ] Prove the supported transfer of an uploaded reference image from the client to Sogni.
- [ ] Start one image generation and return a usable result in ChatGPT and Codex.
- [ ] Test with two accounts and verify that jobs and files cannot be accessed across accounts.
- [ ] Record reusable components, remaining gaps, and the implementation estimate.

**Completion criteria:** a fresh user can connect and generate on both intended surfaces, with verified account isolation.

**Initial time box:** 1–2 engineering days for feasibility findings, not a commitment to complete production OAuth in that time. Estimate the remaining work from the result.

Reference: [OpenAI authentication requirements](https://developers.openai.com/plugins/build/auth).

## Milestone 3 — Build the hosted tools and media flow

- [ ] Expose focused tools for the supported generation actions.
- [ ] Expose job status, results, cancellation, and necessary cost-confirmation actions.
- [ ] Map these operations to Sogni's existing durable workflow services where their contracts fit.
- [ ] Define explicit input/output schemas and accurate tool annotations.
- [ ] Handle long-running video/music jobs without requiring one uninterrupted client connection.
- [ ] Make retries safe against duplicate jobs and charges.
- [ ] Resolve concrete model settings before quoting costs; preserve existing cost-authorization behavior.
- [ ] Support uploaded references and downloadable outputs, including expired-link recovery.
- [ ] Preserve original reference images, match aspect ratios, and avoid deep crops for image-to-video and first/last-frame workflows.
- [ ] Return clear states for authentication, entitlement, unavailable-model, cancellation, and generation failures.
- [ ] Establish bounded logging and operational metrics for the integration.

**Completion criteria:** all five workflows work from request through delivery, including recovery from interrupted connections.

Reference: [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server).

## Milestone 4 — Prepare the public skills and listing

- [ ] Adapt the submitted skills to use hosted tools and uploaded media.
- [ ] Declare required MCP dependencies and document the expected tool sequence.
- [ ] Package every referenced instruction, schema, and supporting resource.
- [ ] Audit instructions for conflicts, overly broad activation, and unsupported claims.
- [ ] Complete and validate the plugin manifest and MCP configuration.
- [ ] Keep credentials and private reviewer information outside the ZIP.
- [ ] Add the listing logo and composer icon.
- [ ] Set the name, subtitle, description, category, and publisher fields.
- [ ] Shorten the subtitle to at most 30 characters. Suggested copy: `Create images, video and music`.
- [ ] Add working HTTPS website, support, privacy-policy, and terms-of-service URLs.
- [ ] Verify the privacy disclosures cover the actual processing, recipients, retention, and user controls.
- [ ] Add three useful starter prompts that match tested capabilities.
- [ ] Confirm general-audience suitability and applicable content handling.
- [ ] Keep credit purchases, subscription checkout, and upgrade promotions outside the plugin experience.
- [ ] Build a self-contained submission ZIP and validate its paths and metadata.

**Completion criteria:** a valid package whose listing accurately describes working behavior.

References: [Build skills](https://developers.openai.com/plugins/build/skills), [package format](https://developers.openai.com/plugins/build/plugins), [submission metadata](https://developers.openai.com/plugins/deploy/submission), and [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines).

## Milestone 5 — Qualify the release and assemble review evidence

Use the five launch workflows as the five required positive review cases. Each case needs a scenario, exact prompt, expected tools, and observable expected result. Run them with the dedicated reviewer account before submission.

| Positive case | Evidence to capture | Status |
| --- | --- | --- |
| Generate an image | Prompt, concrete settings, expected tool, usable image | Not run |
| Edit an uploaded image | Original reference, requested change, usable edited image | Not run |
| Animate an uploaded image | Original still, aspect ratio, playable clip | Not run |
| Animate between two uploaded images | Original endpoint stills, aspect ratio, playable transition | Not run |
| Generate music | Prompt, duration/settings, playable audio | Not run |

| Negative case | Expected behavior | Status |
| --- | --- | --- |
| Access another account's job or media | Deny access without revealing protected data | Not run |
| Request planning only | Provide the plan without starting generation or spending credits | Not run |
| Request disallowed content | Apply the appropriate refusal or safe handling | Not run |

- [ ] Test expired authentication and reauthorization.
- [ ] Test insufficient entitlement and concrete cost confirmation.
- [ ] Test cancellation, duplicate retries, interrupted connections, unavailable models, and failed downloads.
- [ ] Test the exact release candidate on the intended ChatGPT and Codex surfaces.
- [ ] Inspect generated media at native resolution; record render times and relevant motion/audio findings.
- [ ] Obtain and record Mark's technical acceptance, following the workspace's media-review conventions.
- [ ] Create a dedicated reviewer account with sample assets and enough entitlement to run the cases.
- [ ] Verify reviewer access works without private-network access or inaccessible MFA, email, or SMS approvals.
- [ ] Record an accessible walkthrough showing the test cases and functionality.
- [ ] Prepare release notes and the test-case metadata.
- [ ] Enter reviewer credentials separately in the secure dashboard.

**Completion criteria:** passing release candidate, complete test evidence, reviewer access, walkthrough, and release notes.

Reference: [Submission review materials](https://developers.openai.com/plugins/deploy/submission).

## Milestone 6 — Submit, publish, and maintain

- [ ] Prepare the production deployment and rollback details for Mark's approval.
- [ ] Deploy the approved endpoint using Sogni's required deployment process and deployment lock.
- [ ] Verify endpoint availability and complete domain verification.
- [ ] Upload the complete plugin ZIP and connect its MCP server.
- [ ] Resolve package, skill, authentication, and tool-scan findings.
- [ ] Review the final materials and complete the required submission attestations.
- [ ] Submit the plugin for review and record its dashboard identity/status.
- [ ] Address review feedback and re-run affected qualification checks.
- [ ] After approval, publish at the agreed launch time.
- [ ] Monitor connection success, completed generations, latency, failures, and support reports.
- [ ] Assign an ongoing maintenance owner.
- [ ] Document separate update procedures for package changes and hosted-tool changes.

**Completion criteria:** published listing, successful post-publication checks, and an assigned operational owner.

Production deployment, submission, and publication are future actions, not authorized by saving this plan. Follow the applicable approval requirements when those actions are ready for review.

OpenAI review duration is an external dependency and is not included in an engineering estimate. See [publishing and updates](https://developers.openai.com/plugins/deploy/submission).

## Dependencies and open decisions

| Decision | Proposed direction | Resolution |
| --- | --- | --- |
| First-release scope | Five workflows in milestone 1 | Pending |
| Public integration | Skills plus hosted MCP from the initial submission | Pending |
| OAuth implementation | Reuse suitable Sogni components; fill MCP-specific gaps | Feasibility pass |
| Endpoint and hosting ownership | Choose a stable production endpoint and accountable owner | Pending |
| Media transfer and result delivery | Prove the full path in ChatGPT and Codex before expanding scope | Feasibility pass |
| Supported models and cost settings | Concrete, validated settings from the active registry | Pending |
| Additional capabilities | Add 3D and uploaded-image reels after shared infrastructure works | Pending |
| Schedule | Estimate after the feasibility pass; track review time separately | Pending |

Milestones 1 and the listing preparation in milestone 4 can advance alongside engineering. Milestone 2 informs milestone 3. Milestone 5 qualifies the completed implementation and package. Milestone 6 follows qualification and the applicable approvals.

## Progress log

Record dates and times in SGT (UTC+8).

| Date | Milestone | Work completed / evidence | Blocker or next action | Owner |
| --- | --- | --- | --- | --- |
| 2026-09-30 | Planning | Saved the proposed implementation and submission plan | Confirm scope and assign the feasibility pass | Unassigned |

## Decision log

| Date | Decision | Reason | Decided by |
| --- | --- | --- | --- |
| — | — | — | — |
