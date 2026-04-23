import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.env",
);

dotenv.config({ path: rootEnvPath, override: true });

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
