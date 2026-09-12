# 🌾 Flow & Accord

> **A world that lives on its own.**
> 20 founders, a stretch of rolling wilderness, 23 resource sites with finite reserves, and a single marketplace.
> No quest lists, no mouse-click commands, and no "what should I do next" hints —
> only a thousand-year lineage that they walk out, build out, give birth to, and fight over themselves.

**Deterministic ecological simulation · Maslow's hierarchy of needs · intergenerational reproduction & social evolution**

> 🌐 简体中文版（Chinese README）→ [README.md](./README.md)

<div align="center">

`v1.50.28` · `Rust core + WebAssembly` · `Open in your browser and play`

</div>

---

## 🎬 This is not a game where you control characters

In traditional simulation games, you are the commander: claim land, assign tasks, push workers. Here, **you are only an observer**.

You don't have to do anything. The tribesfolk will get hungry and thirsty on their own, haul water and grain home on their own, wear the first path into existence between the springs and berry bushes on their own, save up building materials and raise the first house on their own, court the person they fancy, marry, have children, and grow old — then the son inherits that leaking thatched hut.

The system only plays the role of "enforcer of physical rules": **placement validation, road-network connection, construction settlement, trade settlement**.
As for "build or not, when, where, marry or not, seize the throne or not" — that is entirely up to them.

> And so you will witness scenes nobody scripted:
> someone stockpiles firewood before winter, while another family shivers through it with bare walls;
> someone marches all the way to the Imperial Road, while another shuffles through the wilderness at 0.5× for a lifetime;
> the very second the old king breathes his last, a young man abandons his half-built house and sprints across the map toward the vacant camp;
> in a water-and-grain crisis, when the wilds run dry, someone clutches their last gold and lunges at the Marketplace — where prices have soared 100× — to buy their life;
> missed a key moment of history? Pull up the rewind controller anytime and drag the time slider to instantly roll back and replay!

---

## ✨ Eight reasons worth watching

### 1. 🧠 Truly autonomous AI: six layers of Maslow's hierarchy + instant intentions

Every tribesfolk carries a pyramid inside, from the top-level "instant behaviors" down to the bottom-line physiological needs — **lower-level needs absolutely block higher-level desires**:

| Layer | Need | What they do |
| :--- | :--- | :--- |
| ⓪ Instant | Bid for a house / court nearby / raise child at home | When conditions are met, the intention is written in that very tick — zero displacement, zero cost — and evaluation keeps descending through the regular branches in the same tick |
| ① Physiological | Throne expedition / quench thirst / forage / rest / found a home | The throne is the ultimate right to allocate survival resources (a vacancy ignites ambition); drink from springs, eat berries; homeless adult males autonomously pick a site and found a home once physiologically stable (avoiding camps & POIs, and must physically walk the route to materialize) |
| ② Safety | Repair house / stock water & grain at home | Repair from under 50% durability all the way back to 100%; when household-ledger stock drops below the threshold (Schmitt hysteresis band), set out to restock; when the wilds run dry, the household head turns straight to the Marketplace to buy survival |
| ③ Belonging & love | Court & marry / supply the family | Single men actively pursue the most attractive single woman; once married, haul supplies for the household ledger with all their might |
| ④ Esteem | Upgrade construction / raise children / quarry materials | When ledger materials meet the bar, promote instantly in that same tick, +1 prestige per tier; male household heads with a tier ≥1 private house and healthy couples autonomously initiate reproduction |
| ⑤ Self-actualization | Save gold for the grand manor / recreational gold panning | No recreational gold panning before the tier-4 grand manor is finished — self-actualization must rest on a lasting legacy |

Decisions **never roll dice** — the same situation always yields the same choice. Whether a resource site is worth a trip is decided by each tribesfolk's **private ruler** (a Schmitt trigger): only worth setting out when stock is above half, no longer worth visiting once it drops below a tenth; if a site runs dry mid-route, they smoothly turn around and reroute on the spot — never teleporting. When the wilderness runs dry, the household head can even go straight to the Marketplace for remote ledger settlement!

Even better, **you can curate their values**: the "🧠 Decision Engine" view on the page lays out all 16 decision branches as draggable cards across 6 layers. Drag a boundary or reorder the cards and the running simulation hot-injects the change immediately — make this tribe put "courting" ahead of "stockpiling", or the reverse, with one-click persistence to disk.

### 2. 🛤️ The roads are worn out by their own feet

There is no pre-built road network. Every stretch of ground the tribesfolk walk accumulates wear, upgrading from wilderness paths all the way to **purple-gold Imperial Roads**; roads nobody walks decay proportionally and quietly grow back into wilderness.

| Tier | Name | Move-speed bonus |
| :--- | :--- | :---: |
| 1 | Dirt trail | 0.50× → |
| 2 | Packed-earth path | ⬆ |
| 3 | Hard stone road | ⬆ |
| 4 | Paved thoroughfare | ⬆ |
| 5 | Imperial Road | 2.20× |

A road trodden by generations is a silent history of a family's migrations.

### 3. 🏰 From a single warehouse to a grand manor

Houses come in 5 tiers: **Warehouse → Thatched Hut → Lean-to Shed → Timber & Stone Lodge → Grand Manor**. Upgrades are a **one-time payment of a fixed material matrix from the household ledger**, promoted instantly in the same tick:

| Tier | Name | Upgrade materials (water/food/wood/stone/gold) | Unlock |
| :--- | :--- | :--- | :--- |
| 0 | 📦 Warehouse | The starting point of founding a home (autonomous site-picking at the end of the physiological layer) | The basic shelter; no reproduction |
| 1 | 🛖 Thatched Hut | Water 50 + Food 50 | Unlocks eligibility to raise children |
| 2 | 🏡 Lean-to Shed | Wood 75 + Water & Food 75 each | A sturdy dwelling for family growth |
| 3 | 🏯 Timber & Stone Lodge | Stone 100 + Water/Food/Wood 100 each | Access to the gold mine |
| 4 | 🏰 Grand Manor | Gold 125 + Water/Food/Wood/Stone 125 each | Recreational gold panning; the ultimate form |

Each promotion grants the household head +1 prestige — and kings and clan patriarchs are born with **+3 prestige** (double identity stacks to +6). Honor is written into the bloodline.

Houses **depreciate naturally** (0.04/s, same rate owned or vacant). When durability falls to half, someone will drop everything to repair it. When an owner dies, the house becomes vacant and is auctioned by the camp agent under the **37% optimal-stopping (wheat-ear) game**:
- During the first 37% observation window, bids only set a benchmark — never sold;
- Once the decision window opens, a new bid ≥ the benchmark closes the deal; if nobody beats the benchmark, it decays smoothly at 0.02 gold/sec, breaking the double deadlock of unaffordability;
- Below the 10% clearing line, it sells to any bid; if nobody wants it, it collapses as durability hits zero.

Bidding sinks fully into the instant layer of individual decisions — a buyer **empties their purse in one shot on every higher-tier listed house across the map at once**, and the executor settles bids one by one in ascending ID order, stopping at the first closing (the one-person-one-house iron rule). Open the dedicated 1240px auction dashboard: wheat-ear timeline, smart-filtered interested-buyer pool, and real-time bidding flow at a glance.

### 4. ❄️ Seasons turn, and winter bites into your firewood reserves

One year = 240 seconds, with temperature oscillating sinusoidally between **-3°C and 31°C**. When winter comes or temperature drops below 5°C, every occupied house above tier 0 burns 0.12 wood per second from the **household ledger** for heating — firewood is the hard currency of winter, and families whose ledgers hit bottom can only grit their teeth through the cold.

Families that laze away spring, summer, and autumn without stockpiling wood pay the price in winter.

### 5. 🧬 Life, death, heredity, and six innate aptitudes

Four physiological metrics (health / satiation / hydration / stamina) continuously metabolize. Deaths by starvation and thirst are tracked separately in the top bar; bodies remain for 12 seconds and gradually weather away.

Every tribesfolk carries six innate aptitudes: **intelligence / strength / charisma / digestion efficiency / sleep efficiency / life expectancy**. Founders are generated from a normal distribution (satiation and hydration baseline 45, carrying a full load of supplies), while newborns take the average of their parents plus a random offset of ±10 — **children with high digestion efficiency endure hunger better, high sleep efficiency recovers faster, and strong children walk faster**. Each person carries four independent backpacks of water/food/wood/stone (100 each); non-gold supplies are hauled on demand.

A married man with a tier ≥1 private house and a healthy couple can conceive: pregnancy lasts ~200 seconds to childbirth, with separate miscarriage (450s) and postpartum (900s) recovery cooldowns; a child's generation, household, clan, and kingdom affiliation are all settled at the moment of birth.

After a few generations, some surnames become visibly "better at surviving".

### 6. 📒 Household → Clan → Kingdom: social evolution

The economy is no magic number — every flow is written into the ledger:

- **Courtship & marriage**: single men autonomously pursue the most attractive single woman at the "Belonging & Love" layer (or as a nearby instant action); every marriage in a lifetime leaves a record — widowhood seals the ledger, remarriage opens a new one;
- **Households & inheritance**: the family follows the man; adult offspring split off with a weighted share of the family assets to found their own households; if a line dies out, property falls to the public granary;
- **Clans**: people sharing a surname automatically form a clan; the patriarch is the oldest living male, collects **clan tax** on schedule, and provides **mutual relief** to members who can't make ends meet;
- **Regions & kingdoms**: every camp is the domain of a king, with the throne passed by **primogeniture**; when the throne is vacant (including orphaned camps), men launch **throne expeditions** — you must physically reach the camp to be formally crowned, and if the target changes hands mid-route you re-target in place;
- **Marketplace**: when the wilds run dry or the household is in dire straits, the household head makes straight for the only Marketplace on the map, grabbing life-saving water and grain at **power-law dynamic prices**; settled in clean 2.0 discrete units, with a fully queryable ring buffer of trade flow — the gold that flows into the void becomes the deflationary anchor of the whole economy.

### 7. 🌳 A thousand-year lineage, clear on a timeline

The lineage tree is not a tangled force-directed mess but a **deterministic timeline**: the Y-axis strictly maps to birth time, so earlier births always sit higher; the main bloodline takes priority placement, and nuclear families sit centered between both parents by birth order; with a time ruler, viewport virtualization, and three-level zoom LOD, hovering only highlights parents and children.

Even fetuses lost to miscarriage or carried off by a mother's death appear in the tree as "deceased offspring" nodes, with cause of death and parentage crystal clear. Let it run overnight and you get a family tree that actually looks like one.

### 8. ⏪ Rewind time, extreme fast-forward, and permanent local saves

- **⏪ Time-rewind controller (tick rollback)**: not just fast-forward — you can roll back! Built on a strongly deterministic Checkpoint + Replay mechanism, enter any historical tick or drag the slider to rewind the world in milliseconds, with `-100` / `-300` / `-900` / `-1800` / `Tick 0` shortcut chips; after rewinding, the simulation auto-pauses for easy inspection.
- **⚡ 1x ~ 1024x evolution speed**: eight speed tiers to switch between freely; **headless mode** skips rendering and runs the pure computing core, so at 1024x you can watch a dynasty rise and fall in the time it takes to drink a coffee.
- **💾 Direct local-file writes & auto-resume**: uses the modern browser File System Access API to write `.json` saves straight to your disk, breaking through the browser's 5MB quota limit; auto-saves every 30 seconds, writes new saves to disk when starting fresh, and with one click re-authorizes and auto-resumes your old save.
- **☀️/🌙 Light & dark dual themes**: one click in the top bar to switch seamlessly between the classic dark-night backdrop and a soft bright mode (`theme-light`), with preference persisted locally.

Through it all, the deterministic Rust core drives everything — same seed, run it ten thousand times, and you get the same history.

---

## 🧭 Your first session: eight moments not to miss

| ⏱️ | Moment | Where to look |
| :--- | :--- | :--- |
| Minute 1 | **The first path**: watch for the faintest dashed line between the camp and the nearest water source | Map road network |
| Minute 3 | **The first warehouse**: some adult male suddenly stops, picks a site on the hillside, and drives the first stake | Map + house panel |
| First winter | **The firewood test**: watch whose ledger wood bottoms out in the heating season | Top-bar temperature + house panel |
| Desperate hour | **Straight to the Marketplace on supply failure**: water and grain run out in the wild, the household head charges to the Marketplace with household gold to buy water and grain in 2.0 steps | Map 🏪 Marketplace + Inspector live gold price & trade flow |
| Sudden change | **The wheat-ear used-house auction**: a vacant house raises a golden breathing sign; buyers bid everything on multiple houses; the benchmark decays smoothly to break the deadlock | Floating sign on map + top-bar 🏛️ auction dashboard |
| Power shift | **The throne expedition**: the moment the old king dies, watch whether anyone abandons a construction site and sprints to the camp to seize the throne | Event log scroller + camp crown sign |
| History replay | **Rewind inspection**: missed a turning point? Drag the rewind slider or enter a tick and travel back to that moment | Top bar / console ⏪ rewind modal |
| Long-run sediment | **Empty houses and a giant lineage tree**: ruins' foundations are left for later generations to rebuild on; open the lineage to survey the vast bloodline spanning generations | Lineage timeline + map vacant nodes |

Click any figure and the Inspector on the right tells you what he **wants most right now, why, and what's in his backpack** — the most addictive part of the whole game.

---

## 🎮 Getting started in three minutes

### Launch

```bash
node frontend/server.js
```

Then open your browser (Chrome or Edge recommended) at `http://localhost:3000`. No complex bundling, no external dependencies to install.

> - On first entry or reset, a prompt will appear to create/connect a local save file; pick or create a `.json` file to start the world — data is permanently stored on your computer's disk;
> - If port 3000 is already occupied, a server instance is already running in the background — just open the browser directly.

### Controls

| Action | Effect |
| :--- | :--- |
| **Left-click a figure** | View Maslow's dominant need, instant intention, decision reason, physiological metabolism, backpack supplies, cumulative mining, and social prestige |
| **Left-click a house** | View building tier, durability depreciation, household-ledger reserves, and family member list |
| **Left-click a landmark** | View reserves, production rate, and live unit price (the Marketplace shows live dynamic gold prices for water & food and the trade flow) |
| **Top bar "⏪ Rewind" / console "⏪ Time Rewind"** | Open the rewind controller; enter any historical tick or drag the slider to instantly roll the world back |
| **Top bar "🏛️ Bids" / double-click a listed house** | Open the dedicated 1240px auction dashboard and watch the wheat-ear timeline, buyer pool, and bidding flow |
| **Top bar "☀️ Theme"** | One-click switch between dark immersive / bright airy visual themes |
| **Console "🧠 Decision Engine"** | Drag the 16 branch cards and boundaries to hot-reorder the tribesfolk's need priorities in real time, with persistence |
| **`Space` / console pause** | Globally pause / resume the simulation |
| **Mouse wheel / right-drag** | Zoom and pan the map viewport (camera auto-follows a selected figure) |
| **Console "🏕️ Reseed"** | Re-seed 20 founders (10 male, 10 female) and begin a brand-new civilization epic |
| **Top bar "💾 Save" / "📂 Load"** | Three-slot saves / direct local-file read-write; save and restore evolution anytime |

After modifying the Rust core and recompiling the WASM, remember to force-refresh with **`Ctrl + F5`** to clear the cache.

---

## 🧠 Technical foundation

| Layer | Implementation |
| :--- | :--- |
| Computing core | Rust deterministic core (30Hz fixed stepping, shared global `WorldRng`, byte-for-byte reproducible under the same seed, millisecond Checkpoint + Replay time rewind) |
| Bridge layer | Zero-dependency WebAssembly export layer: linear-memory JSON snapshots & static high-throughput buffers |
| Presentation layer | Native static frontend (ES6+) + dual-theme Canvas rendering pipeline, zero front-end build chain |
| Storage engine | File System Access API native disk writes + IndexedDB handle persistence + localStorage fallback with three slots |
| Tunable hyper-parameters | **232** parameters centralized in `frontend/js/config.js` and split config files (incl. the upgrade-cost matrix; lighting / rendering live in separate pure-frontend configs), one-to-one with the Rust `SimConfig` fields; refresh to apply, no recompilation needed |
| Quality gates | `node tools/test-wasm.js` (determinism / bounds-safety / no-NaN / long-run stability) + `config-check.js` (frontend-backend parameter alignment) + `diagnose.js` (headless diagnostic engine) |

---

## 🗺️ Roadmap

**✅ Shipped**

- ✅ **M1~M5** Ledger & social institutions: household / marriage / clan / kingdom / empire (v1.0.0 ~ v1.44.7)
- ✅ **M6** Housing de-warehousing: household ledger = single source of truth for family reserves; instant house upgrades (v1.4.0)
- ✅ **M7** Household inventory Schmitt trigger: restocking fully decoupled from house tier (v1.5.0)
- ✅ **M8** House upgrade cost matrix: 20 hyper-parameters, fixed water/food/wood/stone/gold matrix (v1.6.0)
- ✅ **M9** Save / load system: local-file direct writes, startup gate, and auto-resume (v1.8.0 ~ v1.28.1)
- ✅ External market & dynamic pricing: the Marketplace, power-law pricing, direct access on supply failure, and 2.0 discrete settlement (v1.13.0 / v1.27.0 / v1.33.0)
- ✅ Used-house exchange: 37% wheat-ear auction, all-in multi-house bidding, and linear benchmark decay (v1.14.0 / v1.26.0 / v1.31.0)
- ✅ ⓪ Instant intention layer: 6-layer Maslow decision engine with 16 dynamically orchestrated branches (v1.29.0; consolidated v1.46.12)
- ✅ Time-rewind controller + dual-theme UI (v1.33.0)
- ✅ **M19** Decision-architecture decoupling: intent / strategy / primitive three-layer split, multi-resource TSP itinerary, graded preemption (v1.46.8 ~ v1.46.10)
- ✅ **M4 FABS** binary snapshot channel: 23× steady-frame compression, 3.5× faster decoding (v1.45.3 / v1.46.0)
- ✅ **Terrain system**: T1 mountain-pass settlement / T2 river-valley static water / shared water pools / terrain-aware road network / dynamic terrain-normal shading (v1.47.1 ~ v1.48.2)
- ✅ **Dynamic seasonal lighting**: 360° annual sun arc, coupled terrain / riverbed / glint (v1.48.0)
- ✅ **Micro aquatic habitat**: fish schools / sun glints (v1.49.0; v1.50.3 ~ v1.50.6 visual noise reduction)
- ✅ **D-A decoration system**: stylized trees / bushes / boulders scattered on an independent RNG, seasonal tints (v1.49.1 ~ v1.49.3)
- ✅ **Decorative seasonality & 3D foliage (TA-01 ~ TA-03)**: continuous leaf-color seasonality, 3D branch skeletons, two-pass canopy (v1.50.21 ~ v1.50.27)
- ✅ **Map gallery page + world seed control**: terrain-template previews / `?seed=` share & reproduce (v1.50.0)

**🔜 Planned** (ordered by player value & validation cost; see [docs/plan/design/01-roadmap.md](./docs/plan/design/01-roadmap.md))

- 🔜 **M10** First session & family-story onboarding: play without save files, understand one family in 5 minutes — curated seeds, an observation target, and event replay
- 🔜 **M11** Camp planning & limited intervention: propose development directions and low-frequency public decisions; the tribesfolk decide whether to adopt them
- 🔜 **M12** Family memory & historical timeline: naming & monuments, family chronicles, causality chains for key events, export & sharing
- 🔜 **M13** Time-slot visitors: deterministic NPC time-travel — the last heir of a doomed house / the hunger-stricken girl from 200 years ago, spawning comparable new timelines
- 🔜 **M14** Exchange, division of labor & resource politics: resident-to-resident matching, gold-standard settlement, specialization
- 🔜 **M15** Political capital & mixed polity: six-dimension political capital (public opinion / technology / capital / coercion / clan law / ideology) and privilege-bill matrices
- 🔜 **M16** Generative social & chronicles (optional): template-generated facts + async LLM tabloids / diaries, never altering simulation facts
- 🔜 **M17** Scaling the core (on demand): ECS & zero-copy snapshots only when performance and population data prove the need
- 🔜 **M18** Hunting, raiders & the force convention: deer hunts / bandit raids / militia mobilization & public-granary bounties
- 🔜 **Map template expansion**: tablelands, river deltas, bays, fjords, valleys, peninsulas, islands, desert oases, alluvial fans, karst and more — 14 planned (un-scheduled)
- 🔜 **M5-2** Condition-triggered multithreaded fork-join (engineering backlog)

---

## 📚 Documentation map

| Document | Content |
| :--- | :--- |
| [AGENTS.md](./AGENTS.md) | Development operation guide & pitfall checklist (read before changing code) |
| [./docs/current/README.md](./docs/current/README.md) | Full index of implemented features & module navigation |
| [docs/current/](./docs/current/) | Per-module mechanism docs (road network / ecology POIs / seasons / metabolism & reproduction / housing / decision AI / frontend / config / ledger / market / save / impact matrix) |
| [./docs/current/tech/19-ui-implementation.md](./docs/current/tech/19-ui-implementation.md) · [./docs/current/tech/20-society-ledger-ui.md](./docs/current/tech/20-society-ledger-ui.md) · [./docs/current/tech/21-frontend-dev-guide.md](./docs/current/tech/21-frontend-dev-guide.md) | UI page panorama · society-ledger UI implementation · frontend development guide |
| [./docs/plan/design/01-roadmap.md](./docs/plan/design/01-roadmap.md) | Long-term project roadmap |
| [./docs/current/tech/05-config-reference.md](./docs/current/tech/05-config-reference.md) | Quick reference for the 232 tunable hyper-parameters (auto-generated) |

---

<div align="center">

**They don't need you. That's what makes this simulation so fascinating.**

Plant 20 people, then watch them walk a wilderness into an empire.

</div>
