---
title: Deployment
tldr: Every push to main deploys automatically; bun run deploy does the same by hand. It checks everything, builds the viewer, model, wiki and server into one release, uploads it through a restricted account, switches the site atomically, checks it over HTTPS at synergon.mightwork.ai and switches back on failure. The host's one-time setup, its service and the cutover from the earlier address are on a page of their own.
status: living
updated: 2026-11-28
tags: [deployment, implementation, wiki, viewer, server]
---

# Deployment

## TL;DR

- **`bun run deploy`** publishes the viewer at `synergon.mightwork.ai/` and this wiki at `synergon.mightwork.ai/wiki/` ([R-64](../10-request/requirements.md#r-64), [R-65](../10-request/requirements.md#r-65), [SF-25](../10-request/requirements.md#sf-25), decision [D-32](../20-decisions/decision-log.md#d-32)). Always run **`bun run deploy --dry-run`** first: it does every local step and prints the exact server commands without running them.
- It refuses to publish when `bun run check` fails, when `bun run wiki lint` finds an error, or when the git working tree has uncommitted changes. What goes live is therefore always a commit that passed every check.
- Each deployment is a **complete new folder** on the server; the live site is a symbolic link switched in one step. A failed check after the switch puts the link back automatically; **`bun run deploy --rollback`** goes back one release by hand.
- The distribution is about **21.3 MB in 151 files** (*measured* on 2026-11-24 with 37 wiki pages; 17 MB in 129 files on 2026-11-23): viewer 0.75 MB, server 65 kB, model 0.94 MB with its description, wiki 19.6 MB, almost all of it images. No file under `private/` or `work/` is ever copied, and every photograph in it is a masked copy.
- **Every push to `main` deploys automatically** (GitHub Actions, [workflow](#continuous-deployment-from-github)). The key GitHub holds can log in only as the unprivileged account `synergon-deploy` and run only the deploy script's own commands inside `/srv/synergon`; the owner approved this design on 2026-11-23, and the new account with the move of 2026-11-25. Since step 1 the workflow first runs every local step without the key, and the key is written only for the upload ([details](#continuous-deployment-from-github)).
- **The server** is part of the release: `server/server.js`, the live channel and the commands behind `synergon.mightwork.ai/api/` ([the platform plan](../30-plan/platform-plan.md)). On the host it is one service, `synergon-server`, on `127.0.0.1:4191`, reached through one Caddy route; its own code is never served ([the server and its host setup](server-and-host-setup.md)). The release keeps today's layout: no split into a served and an unserved folder ([D-42](../20-decisions/decision-log.md#d-42)).
- **Order of the first rollout:** the host's setup (`deploy/setup-server.sh --apply`) must run **before** the first release reaches `main`; the deploy refuses otherwise. **Status on 2026-11-25: prepared, not yet run.** The files, the setup script and its tests are in the repository; the owner approves the commands as one batch ([order and status](server-and-host-setup.md#order-of-the-first-rollout)).
- **The address.** Synergon is served at `synergon.mightwork.ai` (the viewer at `/`, the wiki at `/wiki/`, the server at `/api/`). The bare domain `mightwork.ai` serves nothing: it answers 404 for every address.

The script is `tools/deploy.ts`, its settings `deploy.config.json`; how the viewer itself works is on the
[viewer page](viewer.md), the checks it runs are on the [checks page](../40-method/checks.md).

<a id="public-rooms-and-existing-station-workspaces"></a>

## What the public site serves

Since 2026-11-27 the public site serves one product, organised as Workspace → Project → Scene
([workspaces, projects and scenes](workspaces-projects-scenes.md)). Caddy forwards `/api/*` unchanged to the
service and rewrites `/workspaces/*` to the page of the release; the paths are the same as on a local installation.
The service (`server/room-public.ts`, bundled as `server/server.js`) runs only the scene API; it no longer contains
the single-station server. At its first start it moves the rooms of the retired room database into projects and
renames that file `rooms-v1.sqlite.migrated`. The single-station data under the data folder is left untouched and is
not served. A rollback selects the earlier application and leaves the store in place.

| Address | Contents |
|---|---|
| `/`, `/llms.txt` | Homepage and the guide for agents |
| `/workspaces/<scene>`, `/workspaces/` | Scene editor; without an ID the last scene of this browser, or a start screen |
| `/api/workspaces`, `/api/workspaces/<id>` | The shared workspace; one workspace's projects and scenes |
| `/api/scenes/<scene>/state\|command\|live\|mcp\|discover\|meta\|content\|seen` | One scene: state, commands, live events, MCP; what its screens show and the viewers' reports of it ([live screen content](live-screen-content.md)) |
| `/api/projects/command`, `/api/projects/mcp` | Create and rename workspaces, projects and scenes |
| `/api/catalog`, `/api/library/<digest>/` | Installed editions and their verified, immutable dependency files |
| `/standards/workstation-screening.md` | Public criteria read by the assessment engine, also rendered in the [standards wiki](../85-standards/workstation-screening.md) |
| `/wiki/` | Public project documentation |

The public room store lives under `/var/lib/synergon/rooms`. Its SQLite database holds public rooms
and assessments. Its `public-library-v1` archive keeps redistributable editions admitted by published
release catalogs. A new edition is verified and installed atomically. Older rooms continue to resolve
the exact geometry, operator files and coordinate frames they saved, even after release folders are
pruned. Include this directory with the existing station data in backups. Local project packages,
imports and customer requirements stay in their own local installation.

## What is published

`bun run dist` builds the room and station browser bundles, the station model, the declared room
editions and their file inventories, the public screening source and the wiki. The backend entry
`server/room-public.ts` builds to `dist/server/server.js`. The release stores its catalog and evaluator
source under `dist/server/`, which Caddy refuses to serve. `version.json` records the revision,
station format, room format and current release pins.

Local distribution checks launch the bundled server against disposable storage. Chromium opens the
room plan, renders the seated operator in 3D and follows an original station link. An isolated edit
and assessment exercise the public API. A second server starts from a release that omits the station
edition and verifies saved room state, exact model bytes, solved eye measurement and the previous
station database row. Production release probes read the station index and metadata only. They also
verify the public room revision, catalog, commands, directory, screening source and project boundary.

The wiki site has navigation by section, a table of contents per page, the TL;DR highlighted, a status
badge and the date of the last update, previous and next links, a search over titles and summaries,
light and dark themes, tables that scroll sideways on a phone, and a link back to the viewer. Every page
carries `noindex`, so search engines are asked not to list it.

Never in the distribution: anything under `private/` (photo originals, solved cameras, unmasked renders)
or `work/`. `bun run dist` compares every file it writes with every file under `private/` by size and
hash and fails on a match; `bun run check` scans every file outside `private/` and `work/` for banned
names. The photo comparisons in the wiki are made from the masked copies only (next section).

## Images for the wiki

**`bun run render --set wiki`** regenerates every model image the wiki uses, under names that never change,
so pages need no edit when the model changes (about 10 s, *measured*):

| Folder | Files |
|---|---|
| `wiki/img/model/` | `rig-b-contact-sheet.jpg` (five orthographic views and one perspective); `rig-b-parts-colour-coded.jpg` (one colour per part, with legend); `rig-b-group-<group>.jpg` for platform, seat, pods, stand, pedals; `rig-b-view-front-left.jpg`, `-rear-right.jpg`, `-operators-eye.jpg`, `-side.jpg` (1600 × 1000); `rig-b-joint-limits.jpg` (seat slide and recline, monitor height and tilt, joystick pitch and roll, armrest pad and a pedal, each at both ends of its travel) |
| `wiki/img/matched/` | per solved photo camera: `rig-<rig>-photo-<n>-side-by-side.jpg` (photo, model), `-outline.jpg` (model outlines on the photo), `-strip.jpg` (all three); `<rig>` is b, c1 or c2, the rig in the photo |

The photo comparisons use the **masked** photographs in `wiki/img/photos/` as the photo layer (the same
framing as the working copies, smaller: the camera's pixel numbers are scaled to fit). While they are made,
the local server has no route to `private/` at all except the camera file, which it answers already
re-pointed at the masked copies; the tool also stops if the page asks for any file it does not expect.
`bun run render --set matched --photos wiki/img/photos` makes the comparisons alone.

An image whose new picture is the same as the file already there (up to the noise of JPEG coding) is left
untouched, so running the set again on an unchanged model changes no committed file. Every image is a
JPEG under 400 kB.

## The deploy pipeline step by step

Settings, in `deploy.config.json` (committed):

```json
{
  "host": "synergon-deploy",
  "remoteRoot": "/srv/synergon",
  "publicUrl": "https://synergon.mightwork.ai/",
  "keepReleases": 5
}
```

`host` is an SSH alias from the deploying person's `~/.ssh/config`; no address, user name or key is
stored in the repository.

1. **Refuse early** (all reasons are listed at once):
   - the git working tree must be clean; a folder that is not a git repository yet counts as not clean
     (override: `--allow-dirty`);
   - `bun run wiki lint` must report no error (override: `--allow-lint`);
   - `bun run check` must pass (no override).
2. **Build locally**, stopping at the first failure; nothing has touched the server yet:

   ```sh
   bun run build               # the model: 0.2 s
   bun run render --set wiki   # the wiki's images: 10 s (--no-images skips it)
   bun run wiki index          # the generated index: 0.01 s
   bun run wiki build          # the wiki site: 0.15 s
   bun run dist                # dist/, tested from /: 1.5 s
   ```

   If these steps changed a committed file (a regenerated image, the index), the site would not match
   the commit, and the deployment stops with the list of files: commit them and run it again.
3. **Ask the server's route first** (new in step 1; only for a release whose `version.json` has a
   `server` entry): with the old release still live, `GET https://synergon.mightwork.ai/api/health`. A 404
   means the web server has no route for the API, hence no 404 rule for `server/` either, and the new
   release would make `server/server.js` public; no answer means the rule cannot be confirmed. Either
   way the deploy stops here, before anything is uploaded, and prints the [order of the first
   rollout](server-and-host-setup.md#order-of-the-first-rollout). A 200 (an older server) or 502/503 (the route without a running
   service, as before the first server release) lets it go on.
4. **Upload** a new release folder named after the build time and the revision, for example
   `20261123T204500Z-3f2c1ab`:

   ```sh
   ssh synergon-deploy 'mkdir -p /srv/synergon/releases'
   rsync -az --delete dist/ synergon-deploy:/srv/synergon/releases/20261123T204500Z-3f2c1ab/
   ssh synergon-deploy 'chmod -R u+rwX,go+rX,go-w /srv/synergon/releases/20261123T204500Z-3f2c1ab'
   ```

   A release folder that already exists is never overwritten.
5. **Switch** the live link in one step (the web server sees either the old or the new release, never a mix):

   ```sh
   ssh synergon-deploy 'ln -sfn /srv/synergon/releases/20261123T204500Z-3f2c1ab /srv/synergon/current.tmp && mv -T /srv/synergon/current.tmp /srv/synergon/current'
   ```

6. **Check the live site over HTTPS**: the viewer page answers 200 with HTML; `version.json` is exactly
   the one just built; the model file has the same size and SHA-256 as the local one; the wiki's start page
   and two wiki pages answer 200. New in step 1, for every release: `server/server.js` must **not** answer
   200 (the server's code is in the release folder but never served). For a release with a server:
   `api/health` must report the deployed revision within 20 s, asked every second (a 404, or a 502 or
   another revision after 20 s, is a failure). Each check is tried three times a second apart. If one
   fails, the link goes back to the previous release, that release is checked, and the command ends with
   an error; the failed release stays on the server to be looked at. Three more things are reported as
   warnings only: `/wiki` redirects to `/wiki/`, the address of a workspace (`/workspaces/<id>`) gives the viewer page, and
   the `X-Robots-Tag: noindex` header is sent.
7. **Tidy up** (only after the checks passed): release folders beyond the five newest are deleted, never
   the live one or the one before it.
8. **Report**: a summary on the screen and `dist/deploy-receipt.json` with the release, the previous
   release, the version, every remote command, every check and the server's state.

`bun run deploy --dry-run` runs steps 1 and 2 for real and prints the probe of step 3 and the commands
and checks of steps 4 to 7 without running them. **`bun run deploy --prepared`** (new in step 1) runs
only steps 3 to 8, and refuses unless the working tree is clean and `dist/version.json` says it was built
from that same commit without uncommitted changes (what a dry run of the clean commit leaves behind);
GitHub Actions uses the pair so that the deploy key is on disk only for the network part. Measured on 2026-11-23 on the build machine (one Apple M2): a dry run takes about 17 s, of
which the documentation images take 10 s, `check` 4.5 s and `dist` with its browser test 1.5 s. The same
pipeline was run end to end against a stand-in server on the build machine (a local folder reached
through a substitute for `ssh`, and a local web server): three deployments, pruning to the newest
releases, `--rollback`, and an automatic switch back after a deliberately failed check all behaved as
described (*tested*). Since the first deployment on 2026-11-23 it runs against the production server
on every push ([production state](#production-state)).

## Rolling back

```sh
bun run deploy --rollback --dry-run   # shows what it would do
bun run deploy --rollback             # live link to the release before the current one, then the same HTTPS checks
```

It does not build anything and does not delete anything. If the older release fails its checks, the link
returns to where it was. By hand, the same is one command (list the releases with
`ssh synergon-deploy 'ls -1 /srv/synergon/releases'`):

```sh
ssh synergon-deploy 'ln -sfn /srv/synergon/releases/<release> /srv/synergon/current.tmp && mv -T /srv/synergon/current.tmp /srv/synergon/current'
```

**Rollback rules since step 1.**

- `--rollback` reads the live release's and the target's `version.json` (with the gate's existing `cat`
  pattern) and **refuses** when the live one has a `server` entry and the target has none: once the host
  runs the server, the site does not go back to a release without it (the service would have no
  `server/server.js` to start and would fail every 2 s). The gate on the server did not change for this.
- It also **refuses** when the live release's `version.json` `reads` names a scene field that the target's
  does not (`reads` lists the scene fields a release can open that an older one may not; `["content"]`, what
  the flat screens show, since 2026-11-28). A scene saved under the live release could otherwise stop opening
  after the switch. Releases before that date have no `reads`, so the site does not go back past it with
  `--rollback`; deploy a fixed release instead. `tools/deploy-tests/deploy-checks.ts` tests the rule.
- The automatic switch-back after a failed deploy is not subject to these rules: it always returns to the
  release that was live just before, so it cannot cross it, and it must work when the very first release
  with a server fails its checks.
- After any switch the service exits by itself (it watches where `current` points, every 2 s) and
  systemd starts it again from the release now live.
- A rollback by hand with the `ln`/`mv` line above bypasses the refusal; use it only to go to a release
  that has a server, once the service exists.

## Live screen content in a release

Since release B of [live screen content](live-screen-content.md) (2026-11-28):

- **The frame policy.** `bun run dist` inserts, right after `<head>` of the release's `index.html`, `<meta http-equiv="Content-Security-Policy" content="frame-src …">` with the app origins and public sites of `server/live-apps.json` (sorted). It sets nothing else: no `default-src`, no `child-src`, so workers, `blob:` and three.js are unaffected. The distribution's own check asserts the tag and that there is no other policy. The local server sends `frame-src https: http://127.0.0.1:* http://localhost:* http://[::1]:*` as a header on its pages instead.
- **A live check.** For a release whose `version.json` `reads` has `content`, the deploy checks that the homepage (and `workspaces/deploy-check` when that page answers 200) carries exactly the tag of the repository's `live-apps.json`. The dry run lists it among its "would check" lines.
- **No outbound requests.** The public server may not open any connection to another host (its service already blocks it); `server/no-outbound.test.ts` fails on any network call in the server's code. App item lists are configuration, refreshed by hand with `bun run live-apps refresh <app>` and committed.
- **Rollback.** `reads: ["content"]` keeps `--rollback` from going back to a release that cannot open what this one stores ([rolling back](#rolling-back)).

<a id="next-admin-run"></a>

## Next admin run

Headers that only an administrator can add, because Caddy serves Synergon's pages as files and a deploy never changes `deploy/synergon.caddy`. None is needed for live screen content step 1; meanwhile the viewer hides *Show* and *Use* when Synergon is itself shown inside another site's frame. Add them to the site block at the next run of the host setup, after checking each on a test release:

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors 'none'` (in addition to the meta tag's `frame-src`, which stays in the page) | no other site can frame Synergon (frame-ancestors cannot be set by a meta tag) |
| `X-Frame-Options` | `DENY` | the same, for older browsers |
| `Permissions-Policy` | deny what no page on a screen needs (for example camera, microphone, geolocation, payment, usb) and delegate nothing to frames | a page on a screen cannot ask for these through Synergon |
| `Origin-Agent-Cluster` | `?1` | Synergon's page runs in its own process group, apart from pages on the screens |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | a window opened by a page cannot reach Synergon's window, while app pages may still open their own popups |

<!-- The exact Permissions-Policy list and COOP value are to be settled at that run; the build plan names the headers, not their values. -->

## What the server must provide

The deploy script never reads or changes the web server's configuration. It expects:

- an SSH alias `synergon-deploy` (the `host` in `deploy.config.json`) that logs in as the unprivileged
  account `synergon-deploy`, which owns `/srv/synergon`; `rsync` and the GNU core utilities (for
  `mv -T`) on the server. Locally the alias is in `~/.ssh/config`; in GitHub Actions the workflow
  writes it;
- on the server, the gate `/usr/local/bin/synergon-deploy-gate` (source: `deploy/synergon-deploy-gate.sh`)
  as the forced command of every key of that account (next section);
- a static file server that serves the folder `/srv/synergon/current` (following the link, looked up on
  every request) at the address path `/` (the root of `synergon.mightwork.ai`), serves `index.html` for a folder,
  redirects a folder asked for without its trailing slash, serves the viewer page for `/workspaces/*`, and
  answers 404 for `/server/*`;
- preferably the header `X-Robots-Tag: noindex` (every page also carries the same instruction as a meta tag).

The site block for the production server is `deploy/synergon.caddy` in this repository (Caddy; one file per
site under `/etc/caddy/managed-sites/`). It serves the host name `synergon.mightwork.ai`: the viewer at `/`, the
wiki at `/wiki/` and everything else in the release from `/srv/synergon/current`, with `X-Robots-Tag: noindex` and
`Cache-Control: no-cache` on pages and data; `/api/*` goes to the server, `/server/*` answers 404, and
`/workspaces/*` gives the viewer page ([the Caddy route](server-and-host-setup.md#the-caddy-route)). Caddy obtains
the HTTPS certificate by itself. The setup script installs the file on the host; a deploy never changes it.
The bare domain `mightwork.ai` has its own file, `deploy/mightwork-apex.caddy`, which answers 404 for every address: nothing
is served from it any more.

The site is served from the root, so a file such as `/srv/synergon/current/wiki/index.html` is the address
`/wiki/index.html`; no prefix is removed.

### The restricted deploy account

Created on the host by `deploy/setup-server.sh --apply` ([the setup](server-and-host-setup.md#the-setup-script-and-the-host-checks)); the account, gate and folders have the same design as the first deployment account of this project, which the owner approved on 2026-11-23.

| Part | What it is |
|---|---|
| Account | `synergon-deploy`, a system user with no password and no sudo; owns `/srv/synergon` and nothing else |
| Keys | `/var/lib/synergon-deploy/.ssh/authorized_keys`, owned by root so the account cannot add keys; written by the setup script from a file of public keys: the GitHub Actions key and the owner's own key for manual deploys, both with `restrict,command="/usr/local/bin/synergon-deploy-gate"`: no shell, no terminal, no port or agent forwarding |
| Gate | `deploy/synergon-deploy-gate.sh`, installed as `/usr/local/bin/synergon-deploy-gate`. It compares the requested command with nine anchored patterns, one per command the deploy script sends (make the release folder, read the live link, list releases, test for a release, upload with rsync, set permissions and confirm two files, switch the link, read a release's `version.json`, delete old releases), all confined to `/srv/synergon`. Anything else is refused with exit code 126 |
| No links | after every upload the gate deletes symbolic links in that release, and it refuses to switch to a release that contains one, because the web server would follow a link to any readable file on the host |
| Log | every allowed and refused command goes to the system log with the tag `synergon-deploy-gate` (`journalctl -t synergon-deploy-gate`) |
| Host key | the server's host key is pinned in `deploy/known_hosts` (checked against the key already trusted for the server's address); the workflow refuses any other |
| Tested | allowed: every deploy command, both the GNU rsync form (GitHub runner) and the macOS openrsync form; refused: `id`, `cat /etc/passwd`, an interactive login, port forwarding, and in a local pattern test 12 injection and escape attempts (extra commands after `;` or `&&`, `$(…)`, paths outside `/srv/synergon`, `..`, links to `/etc`) |

To revoke GitHub's access: delete the first line of the server's `authorized_keys` (or the repository
secret `SYNERGON_DEPLOY_SSH_KEY`). To change what the deploy may do, change `tools/deploy.ts` and the gate together.

## Updating production after a change

After changing the model or the wiki:

1. Model: `bun run build` and `bun run check`; then `bun run render --set wiki` so the wiki's images
   show the new model (images that did not change are left as they were).
2. Wiki: `bun run wiki index` and `bun run wiki lint` until it reports no error.
3. Commit everything and push to `main`: GitHub Actions deploys it.
4. Or by hand: `bun run deploy --dry-run`, read what it prints, then `bun run deploy`.

Doing 1 to 3 before deploying means the deploy's own rebuild changes nothing and it does not stop to ask
for a commit. To publish a wiki fix without regenerating the images, add `--no-images`.

## Continuous deployment from GitHub

A second workflow, `.github/workflows/check.yml` (2026-11-25), runs step 3 below on every push to any other branch: the same checks and build, with no environment, no secret and no upload, so a branch shows on GitHub's own machine whether `main` would deploy.

Workflow `.github/workflows/deploy.yml`, first set up on 2026-11-23 at the owner's request and moved to the new account for Synergon.

1. **Trigger**: every push to `main`, or by hand from the repository's Actions tab. Runs never overlap
   (one deploy at a time) and a run that is already deploying is never cancelled.
2. **Runner**: GitHub's Ubuntu 24.04 machine; Bun 1.4.0; `bun install --frozen-lockfile`; Google Chrome
   from the runner image for the headless checks, with WebGL in software (SwiftShader).
3. **Check and build, without the key** (since step 1): `bun run deploy --dry-run --no-images`, the same
   refusal rules as a manual deploy: every check, wiki lint, clean commit, build, wiki site, distribution
   with its own browser check (and the built server behind it).
4. **Key**: only then is `SYNERGON_DEPLOY_SSH_KEY` written to a file; the SSH settings pin the server's host key from
   `deploy/known_hosts`.
5. **Upload, switch and check**: `bun run deploy --prepared` (the route probe, upload, switch, the live
   checks including the server's health, automatic switch-back on failure); the key is removed in the next
   step, which runs whatever happened.
6. **Receipt**: `dist/deploy-receipt.json` is kept as a run artifact.

**Hardening added in step 1** (security review of step 1, S9):

- Each action (`actions/checkout`, `oven-sh/setup-bun`, `actions/upload-artifact`) is pinned to the
  commit its tag pointed to on 2026-11-24, the tag kept as a comment, so a moved tag cannot change what
  runs next to the deploy key. The workflow file says how to update them.
- The job runs only for `refs/heads/main`, also when started by hand, in the GitHub environment
  `production`; the checkout keeps no credentials (`persist-credentials: false`).
- `setup-bun` downloads Bun without a pinned checksum, and this Bun builds the `server.js` that runs on
  the host, so the job stops unless `bun --revision` is `1.4.0+34cbb9a40` (the official 1.4.0 build; a
  weak check, not a checksum).
- **For the owner** (settings only the owner can change): the one secret the workflow reads is
  `SYNERGON_DEPLOY_SSH_KEY`, the private half of the key whose public half is on the server for the account
  `synergon-deploy`. Create it in the environment `production` (not as a repository secret), limited to the
  branch `main`, and protect `main`. The workflow writes the SSH alias `synergon-deploy` itself (host name
  `synergon.mightwork.ai`, the host key from `deploy/known_hosts`).

What the runner cannot do, and how it is handled:

- **No private files.** The photo cameras and the photographs never enter the repository. The
  projection self-test then uses its two synthetic cameras only, and the photo-comparison images are
  not regenerated (`--no-images`): the committed images are published. After changing the model,
  regenerate the images locally (`bun run render --set wiki`) and commit them, or they will show the
  old model.
- **No GPU.** The frame-rate check runs in software rendering and reports a warning, not a failure,
  below 55 frames per second; the real figure is the one measured on a development machine.

A manual deploy from a working copy (`bun run deploy`) goes through the same restricted account and gate
(*tested* on the earlier address on 2026-11-23: 14.8 s, every server command allowed by the gate, including the macOS rsync form).

The model file built on the runner is not byte-identical to one built on macOS (floating-point functions
differ slightly between platforms; each platform is deterministic on its own), so the live model's
SHA-256 is the runner's. The live check compares against the file that was uploaded.

**First runs.** The first two runs (commits `ac78fc6` and `d21bd59`) refused to deploy because a check
failed on the runner ([F-32](../60-lessons/failures-and-fixes.md#f-32)); nothing was uploaded. The third
(commit `66c7bbd`, 2026-11-23 22:34 UTC) passed every check on the runner and deployed release
`20261123T223434Z-66c7bbd` in 70.1 s: check 22 s (it is slower in software rendering), distribution
with its browser verification 28.6 s, upload and switch about 10 s, nine live checks passed. The gate's
log shows every server command of that run allowed, including GNU rsync's upload form.

## Production state

**Not live yet** (2026-11-25): the cutover to `synergon.mightwork.ai` is prepared and waits for the owner's approval.
What is decided and what will be true afterwards:

| Item | Value |
|---|---|
| Addresses | viewer <https://synergon.mightwork.ai/>, wiki <https://synergon.mightwork.ai/wiki/>, API `https://synergon.mightwork.ai/api/` |
| Host | the production host that already runs the owner's other sites (Caddy on ports 80 and 443); `synergon.mightwork.ai` resolves to it (checked 2026-11-25, the same address as `mightwork.ai`) |
| Account and folders | the account `synergon-deploy` and its restricted alias; `/srv/synergon` (releases), `/opt/synergon/runtime/bun`, `/var/lib/synergon` (the server's data); all created by the setup script |
| Site block | `deploy/synergon.caddy` as `/etc/caddy/managed-sites/synergon.caddy`; the certificate comes from Caddy by itself |
| The bare domain | `deploy/mightwork-apex.caddy`, installed by `setup-server.sh --retire-apex` after the first deploy: 404 for every address, no route left. The earlier address and its service, account and folders are removed in the cutover, after an archive of the old data is copied to the owner's laptop |
| First deployment | `bun run deploy` from the laptop once the setup has run; its receipt goes to `dist/deploy-receipt.json` |
| Time of a full deployment (measured on the earlier address) | 70 s from GitHub Actions (runner, software rendering); 15–25 s from the development machine, including check, build, documentation images, wiki build, distribution with its own browser verification, upload and live checks; a dry run takes about 17 s |
| Release history | see `ssh synergon-deploy 'ls -1 /srv/synergon/releases'`; the deploy keeps the newest 5 |

This table is filled in with the measured state after the cutover.

### Updating production

After a change to the model, the viewer or the wiki: commit, push, then `bun run deploy`. The script
refuses to deploy an uncommitted or failing tree, builds everything from the commit, uploads a new
release folder, switches `current` only after the upload, checks the live site and switches back
automatically if a check fails. `bun run deploy --rollback` returns to the previous release.
