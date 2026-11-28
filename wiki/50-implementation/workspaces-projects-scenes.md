---
title: Workspaces, projects and scenes
tldr: Synergon is organised as Workspace → Project → Scene on both installations. A scene is the live layout (room, placed assets, optional seated operator, undo history) and opens at /workspaces/{scene}. One folder-based store holds everything; the older single-station product and the separate room store are retired.
status: living
updated: 2026-11-28
tags: [implementation, server, viewer, workspaces, projects, scenes]
---

# Workspaces, projects and scenes

## TL;DR

- **Workspace → Project → Scene.** A workspace holds projects; a project holds scenes plus its record, named versions and saved assessments; a scene is what you see and edit.
- **A scene** is a room (walls, door, window), zero or more placed assets and optionally one seated operator, with its own revision and undo. Inside a scene, **Show one asset** views one asset on its own; that changes only the view.
- **Links name the scene only**: `/workspaces/{scene}`. The API is `/api/scenes/{scene}/…`. The same paths work locally and on the public site.
- **New users start in one click**: **Open demo** on the homepage always opens a freshly reset, furnished demo scene. Your own scenes are in the breadcrumb at the top, with a **Play** button that opens the selected one.
- **Retired**: the single-station workspaces of the public site, the `/api/room` and `/workspaces/room` prefixes and the separate room database.

## The model

| Level | Holds | Created with | Default name |
|---|---|---|---|
| Workspace | projects | `workspace.create` (also makes a first project and scene) | My workspace, then Workspace 2 … |
| Project | scenes, project record, named versions, saved assessments | `project.create` (also makes a first scene) | My project, then Project 2 … |
| Scene | room, placed assets, optional seated operator, lighting, what its screens show, undo history | `project.scene` | Scene 1, Scene 2 … |

Scenes made from the menus start as an empty room. Only the demo scene is the furnished example (two operator stations, a freestanding display and a wall display). Names may repeat; agents act by ID and ask when a name matches more than one item.

## In the viewer

- **Homepage**: **Open demo** opens the demo scene, reset to the furnished default every time. The bar at the top is a breadcrumb of three menus, **Workspaces ▾ › Projects ▾ › Scenes ▾**, filled in with your last scene when you have one, followed by an **Open** button (a play symbol) that appears once a scene is selected and opens it. Choosing a scene in its menu opens it directly; a single project is chosen for you. **Wiki** is at the right.
- **Editor**: the head of the left panel shows `Workspace ▾ › Project ▾` on a small first line and `Scene ▾` as the heading. Each menu lists its items, marks the current one, and ends with **New …** and **Rename …**; the project menu adds **Project details…** on a local installation.
- **New …** asks only for a name, filled in with the next default; Enter accepts.
- `/workspaces/` reopens the last scene this browser opened; without one it offers **Open demo**. Nothing is ever created by merely loading a page, so crawlers create nothing.
- On the public site a one-time note in a visitor's own scene says: "This is your scene. Changes save automatically. Anyone with the link can open it." A demo scene says each time: "This demo resets each time you open it from the homepage. Your changes here are not kept."

## The demo

Each browser has its own demo scene (`demo.open`), kept in a workspace "Demo" that no list shows. Opening the demo from the homepage resets that scene to the furnished default (a new revision with an empty undo history) and opens it, so a demo always starts fresh and one visitor never resets another's. The demo workspace never lists its scenes, so no visitor can find another's demo. Only making a browser's first demo scene counts against the creation limit. A demo scene starts without [live screen content](live-screen-content.md) but accepts it, so a visitor can try it there.

## On the public site

The public site is an open sandbox without sign-in. The **Workspaces** menu lists the shared workspace and the workspaces this browser created or opened (kept in the browser). Any other workspace opens only from its link. Creation is rate-limited per visitor and in total; a scene holds at most 300 placed assets and 1 MB. Project files, named versions, comparisons, restores and transfers (export and import) work only on a local installation; the public server refuses them. Every scene of the shared workspace (the shared example) refuses live screen content edits (`content_not_here`), so no visitor can make every other visitor start a scenario; on the public site only YouTube and Vimeo pages are allowed on screens ([live screen content](live-screen-content.md#security-rules)).

## Storage

One store for both installations: the project folders of [portable room projects](portable-projects.md), under `<data>/projects/`. `workspaces.json` in that folder lists the workspaces; each `project.json` names its workspace. Projects written before workspaces existed belong to the default workspace ("My workspace" locally, "Shared" on the public site). On the public server the in-memory index of projects is authoritative, so an unknown ID never makes the server walk the store.

**Migration (once, automatic).** At start, every room of the retired room database (`rooms-v1.sqlite`) becomes a project of its own in the default workspace. The scene keeps its ID (old links keep working), revision, undo history and saved assessments. The database file is then renamed `rooms-v1.sqlite.migrated`, never deleted. Old links `/workspaces/room/{id}` are rewritten in the browser to `/workspaces/{id}`.

## Retired

- **Single-station workspaces** (the earlier product with one rig per workspace, its viewer, API and guide) are no longer served by the public site. Their data on the server is left untouched. Their viewer and server stay in the repository only as the internal render tool of the asset toolkit (`bun run render`, `bun run check`), not deployed.
- **The `/api/room` and `/workspaces/room` prefixes** and the "Room workspaces" directory page.
- **The room database** (`rooms-v1.sqlite`), after the migration.

## Deferred

Keeping a copy of the demo as a scene of one's own; duplicating and deleting scenes, projects and workspaces; removing unused sandbox workspaces after a while; a phone layout with a drill-down sheet; an asset editor.

## Related

- [How to work with Synergon through an AI agent](../80-reference/agent-how-to.md)
- [Remote commands](../80-reference/remote-commands.md): the full agent interface.
- [Room layout](room-layout.md): the scene editor.
- [Portable room projects](portable-projects.md): project record, versions and transfer.
