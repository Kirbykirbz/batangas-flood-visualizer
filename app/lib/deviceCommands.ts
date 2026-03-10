type DeviceCommand = {
  restart: boolean;
};

const g = globalThis as unknown as {
  __deviceCommands?: Record<string, DeviceCommand>;
};

if (!g.__deviceCommands) g.__deviceCommands = {};

const store = g.__deviceCommands;

export function setRestart(deviceId: string) {
  if (!store[deviceId]) store[deviceId] = { restart: false };
  store[deviceId].restart = true;
}

export function consumeCommand(deviceId: string): DeviceCommand {
  const cmd = store[deviceId] ?? { restart: false };
  store[deviceId] = { restart: false }; // auto-clear after read
  return cmd;
}