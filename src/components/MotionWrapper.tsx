"use client";

import React from "react";
import { motion, useReducedMotion, type HTMLMotionProps, type Variants } from "framer-motion";

const fadeInGPU: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } },
};

// Export a named `fadeIn` variant for other modules to reuse
export const fadeIn = fadeInGPU;

export default function MotionWrapper({ children, className, ...rest }: React.PropsWithChildren<{ className?: string } & HTMLMotionProps<"div">>) {
  const reduce = useReducedMotion();

  // When reduced motion is requested, skip entrance animations
  const variants = reduce ? undefined : fadeInGPU;

  const style: React.CSSProperties = {
    willChange: "transform, opacity",
    transform: "translateZ(0)", // hint to the browser to use GPU compositing
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };

  return (
    <motion.div
      {...(variants ? { initial: "hidden", animate: "show", variants } : {})}
      className={className}
      style={style}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
