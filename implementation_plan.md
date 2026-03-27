# Implementation Plan - Modular Diving Logbook (DIVE-FLOW)

## Overview
A revolutionary, modular diving logbook that focuses on the mental/physical state of the diver, AI-powered species recognition, and a customizable "Lego-like" architecture.

## Core Pillars
1. **The Modular Base (Baukasten)**: Users pick components (Photo, Bio, Tech, Freediving, etc.) to tailor their UI.
2. **Mindful Diving**: Tracking Stress, Breath, HRV, and the "Flow-Index".
3. **Species Pokedex**: AI recognition (Gemini Pro Vision) and personal biological collection.
4. **Geo-Intelligence**: Map-based logging with automatic spot descriptions via API.
5. **Universal Persistence**: Cloud Sync via Supabase with Offline-first capability.

## Technical Architecture
- **Framework**: Static Vanilla Web-Stack (HTML5, CSS3, JS).
- **Backend/DB**: Supabase (Postgres, Auth, Storage).
- **AI**: Gemini 1.5 Pro via Vercel Serverless Functions.
- **Offline**: PWA (Service Workers, Cache API, Background Sync).
- **Styling**: Vanilla CSS (The "Abyssal" Design System).
- **Map**: Leaflet.js (Dark Filtered).

## Implementation Progress
- [x] **Modular Base System**
- [x] **Diver Profile**
- [x] **Mindful Diving**
- [x] **Species Pokedex (Mock)**
- [x] **Geo & Maps Integration**
- [x] **Gear & Maintenance**
- [x] **Buddy & Sync**
- [ ] **Infrastructure Upgrade**
    - [ ] Progressive Web App (PWA) Setup (Offline Support)
    - [ ] Supabase Database Integration (Cloud Sync)
    - [ ] User Authentication
- [ ] **AI Pokedex Upgrade**
    - [ ] Image Upload to Cloud Storage
    - [ ] Gemini 1.5 Pro Vision Analysis
    - [ ] Collection Management
- [x] **Initial Deployment** (dive-flow.vercel.app)

## Final Design Aesthetic (The "Abyssal" Theme)
- **Primary Color**: Deep Midnight Blue (`#0a192f`)
- **Accent Color**: Bioluminescent Cyan (`#64ffda`)
- **Secondary Accent**: Coral Pink (`#ff7f50`) for warnings/high stress.
- **Glassmorphism**: UI elements should look like "frosted dive masks".
- **Micro-animations**: Subtle bubble effects, wave-like transitions between pages.

