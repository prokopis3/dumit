import { env } from "@/lib/env";
import type { DomainAvailability } from "@/lib/types";

const DNS_TIMEOUT_MS = 280;
const RDAP_TIMEOUT_MS = 1200;

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveDnsViaEndpoint(domain: string, url: string): Promise<DomainAvailability> {
  const response = await fetchWithTimeout(url, DNS_TIMEOUT_MS, {
    headers: { accept: "application/dns-json" },
  });

  if (!response.ok) {
    throw new Error(`DNS resolver failed with status ${response.status}`);
  }

  const data = (await response.json()) as { Status?: number };
  return {
    domain,
    available: data.Status === 3,
    source: "dns",
  };
}

async function checkDns(domain: string): Promise<DomainAvailability | null> {
  const endpoints = [
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`,
  ];

  for (const endpoint of endpoints) {
    try {
      return await resolveDnsViaEndpoint(domain, endpoint);
    } catch {
      continue;
    }
  }

  return null;
}

async function checkRdap(domain: string): Promise<DomainAvailability | null> {
  if (!env.enableRdapFallback) return null;

  try {
    const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
    const response = await fetchWithTimeout(url, RDAP_TIMEOUT_MS, {
      headers: {
        accept: "application/rdap+json, application/json",
      },
    });

    if (response.status === 404) {
      return { domain, available: true, source: "rdap" };
    }

    if (response.status === 429 || response.status >= 500) return null;

    if (!response.ok) return null;

    return { domain, available: false, source: "rdap" };
  } catch {
    return null;
  }
}

export async function checkDomainAvailability(
  domain: string,
  options?: { allowRdapFallback?: boolean },
): Promise<DomainAvailability> {
  const dnsResult = await checkDns(domain);
  if (dnsResult) return dnsResult;

  const shouldUseRdap = options?.allowRdapFallback ?? true;
  const rdapResult = shouldUseRdap ? await checkRdap(domain) : null;
  if (rdapResult) return rdapResult;

  return {
    domain,
    available: false,
    source: "dns",
  };
}
