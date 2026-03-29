import { NextRequest } from "next/server";

function normalizeDeviceIdToEnvKey(deviceId: string): string {
  return deviceId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

export function getExpectedDeviceToken(deviceId: string): string | null {
  const envKey = `DEVICE_COMMAND_TOKEN_${normalizeDeviceIdToEnvKey(deviceId)}`;
  const token = process.env[envKey];
  return token?.trim() || null;
}

export function requireDeviceAuth(req: NextRequest, deviceId: string) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  const expected = getExpectedDeviceToken(deviceId);

  if (!expected || !token || token !== expected) {
    throw new Error("Unauthorized device");
  }
}