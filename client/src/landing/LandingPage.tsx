import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { ReactLenis } from "lenis/react";
import { Features } from "./Features";
import { API_BASE, useLowPower, useMediaQuery } from "./lib";
import { setPageMeta } from "../lib/meta";
import { SEO } from "../seo";
import { Cli, Faq, FinalCta, Footer, Hero, Manifesto, Metrics, Nav } from "./Sections";
import "./styles.css";

const LandingPage = () => {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  // phones scroll natively; smoothing touch scroll makes it feel stuck
  const touch = useMediaQuery("(pointer: coarse)");
  const lowPower = useLowPower();

  useEffect(() => {
    setPageMeta(SEO["/"].title, true, SEO["/"].description);
    // a hello for the people who open devtools on landing pages
    console.log(
      `%c t. %c themis %c\nYou opened devtools. Respect.\nTry: curl ${API_BASE}/api/health\nCourt is in session.`,
      "background:#ff6b3d;color:#0a0a09;font-weight:700",
      "background:#0a0a09;color:#efebe2",
      "color:#a7a297",
    );
  }, []);

  const page = (
    <div className="lp bg-ink font-sans text-paper antialiased">
      <Nav />
      <main id="main">
        <Hero />
        <Metrics />
        <Features />
        <Manifesto />
        <Cli />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      {touch || lowPower ? (
        page
      ) : (
        <ReactLenis root options={{ lerp: reduced ? 1 : 0.11, smoothWheel: !reduced }}>
          {page}
        </ReactLenis>
      )}
    </MotionConfig>
  );
};

export default LandingPage;
