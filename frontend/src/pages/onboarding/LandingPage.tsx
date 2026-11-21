import "./site.css";
import { HeroGround, Hero } from "./landing/Hero";
import { SiteNav } from "./landing/SiteNav";
import { Problem } from "./landing/Problem";
import { WhatChanges } from "./landing/WhatChanges";
import { HowItWorks } from "./landing/HowItWorks";
import { RealPerson } from "./landing/RealPerson";
import { TheirScreen } from "./landing/TheirScreen";
import { OurScreen } from "./landing/OurScreen";
import { LivingArchive } from "./landing/LivingArchive";
import { Postcards } from "./landing/Postcards";
import { Pricing } from "./landing/Pricing";
import { Questions } from "./landing/Questions";
import { FinalCta } from "./landing/FinalCta";

/**
 * The front door — "Recall Website v3.dc.html" (Claude Design project
 * 6d67cd0d, 18 Sep 2026), rebuilt section for section.
 *
 * A light page that goes dark four times, Archivo for the headings, Roboto for
 * the reading, Roboto Mono for every label, Cormorant Garamond for anything
 * anyone says out loud, and the red dot as the one accent. Where the design
 * draws a product state — the channel on her wall, the family's shelf, a
 * printed card — it is drawn here the same way: a picture of the product,
 * never live data. A stranger reading this page has no archive to read from.
 *
 * THIS FILE IS A TABLE OF CONTENTS. Each section owns its own layout AND its
 * own copy in three languages, so an edit to one never touches the file
 * another lives in.
 *
 * WHAT v3 ADDED over the last version: "What changes" (what Recall is worth to
 * the person, the family and everyone), "Built around a real person" (the one
 * section that is not about the product), and "Questions families ask". The
 * problem section was rewritten to open on what the reader is already doing
 * rather than on the state of the world.
 *
 * ONE ARCHIVE ACROSS THE WHOLE PAGE. The channels come from ./archive, because
 * the design shows channel 06 as three different holidays in three different
 * sections and a reader who notices stops believing the screenshots.
 *
 * Two places where the design and the owner's later word disagree, and the
 * later word wins: the language switch is the shared capsule (v3 still draws
 * the ringed FR/NL/EN it replaced), and the footer's identity comes from
 * lib/seller.ts rather than being typed into the design.
 */
export function LandingPage() {
  return (
    <div className="site scroll-thin h-full overflow-y-auto">
      <HeroGround>
        <SiteNav />
        <Hero />
      </HeroGround>

      <Problem />
      <WhatChanges />
      <HowItWorks />
      <RealPerson />
      <TheirScreen />
      <OurScreen />
      <LivingArchive />
      <Postcards />
      <Pricing />
      <Questions />
      <FinalCta />
    </div>
  );
}
