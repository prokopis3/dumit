import Image from "next/image";
import type { ModelProvider } from "@/lib/types";
import { providerLabel } from "@/lib/providerMeta";
import { useEffect, useState } from "react";

const DEFAULT_PROVIDER_ICON = "/provider-defaults.svg";

export const PROVIDER_FALLBACK_ICON: Record<ModelProvider, string> = {
  groq: "/provider-logos/groq.svg",
  grok: "/provider-logos/grok.svg",
  gemini: "/provider-logos/gemini.svg",
  openai: "/provider-logos/openai.svg",
  huggingface: "/provider-logos/huggingface.svg",
};

export function ProviderLogo(props: {
  provider: ModelProvider;
  sizeClassName?: string;
  className?: string;
  showLabel?: boolean;
  labelClassName?: string;
  srcOverride?: string;
}) {
  const sizeClassName = props.sizeClassName ?? "h-4 w-4";
  const label = providerLabel(props.provider);
  const providerLocalSrc = PROVIDER_FALLBACK_ICON[props.provider] ?? DEFAULT_PROVIDER_ICON;
  const preferredSrc = props.srcOverride ?? providerLocalSrc;
  const [imageSrc, setImageSrc] = useState(preferredSrc);

  useEffect(() => {
    setImageSrc(preferredSrc);
  }, [preferredSrc]);

  return (
    <span className={props.className ?? "inline-flex items-center gap-1.5"}>
      <Image
        src={imageSrc}
        alt={`${label} logo`}
        className={`${sizeClassName} shrink-0 object-contain`}
        loading="lazy"
        unoptimized
        width={16}
        height={16}
        onError={() => {
          setImageSrc((current) => {
            if (current === preferredSrc && preferredSrc !== providerLocalSrc) {
              return providerLocalSrc;
            }
            if (current !== DEFAULT_PROVIDER_ICON) {
              return DEFAULT_PROVIDER_ICON;
            }
            return current;
          });
        }}
      />
      {props.showLabel ? <span className={props.labelClassName}>{label}</span> : null}
    </span>
  );
}
