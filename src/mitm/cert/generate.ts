import path from "path";
import fs from "fs";
import { MITM_DIR } from "../paths";
import { generateRootCA, loadRootCA, generateLeafCert } from "./rootCA";

interface CertData {
  key: string;
  cert: string;
}

/**
 * Generate Root CA certificate (one-time setup)
 * This replaces the old static wildcard cert approach
 */
function generateCert(): { key: string; cert: string } {
  return generateRootCA();
}

/**
 * Get certificate for a specific domain (dynamic generation)
 * Used by SNICallback in server.js
 */
function getCertForDomain(domain: string): CertData | null {
  try {
    const rootCA = loadRootCA();
    const leafCert = generateLeafCert(domain, rootCA);
    return {
      key: leafCert.key,
      cert: leafCert.cert
    };
  } catch (error: any) {
    console.error(`Failed to generate cert for ${domain}:`, error.message);
    return null;
  }
}

export { generateCert, getCertForDomain };
