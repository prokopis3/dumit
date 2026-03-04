"use client";

import React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

export const fadeIn = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
};

export default function MotionWrapper({ children, className, ...rest }: React.PropsWithChildren<{ className?: string } & HTMLMotionProps<"div">>) {
  return (
    <motion.div initial="hidden" animate="show" variants={fadeIn} className={className} {...rest}>
      {children}
    </motion.div>
  );
}
