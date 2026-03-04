"use client";

import React from "react";
import clsx from "clsx";

type Tone = "emerald" | "cyan" | "violet" | "amber";

interface Props {
  children?: React.ReactNode;
  className?: string;
  tone?: Tone;
}

export default function GlassCard({ children, className, tone = "emerald" }: Props) {
  const toneClass = {
    emerald: "tone-emerald",
    cyan: "tone-cyan",
    violet: "tone-violet",
    amber: "tone-amber",
  }[tone];

  return (
    <div className={clsx("glass-card p-4", toneClass, className)}>
      {children}
    </div>
  );
}
