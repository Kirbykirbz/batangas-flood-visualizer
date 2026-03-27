// app/lib/sensorsRepo.ts
import { supabase } from "@/lib/supabaseClient";

export type SensorRecord = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone_label: string | null;
  dry_distance_cm: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listSensors(): Promise<SensorRecord[]> {
  const { data, error } = await supabase
    .from("sensors")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as SensorRecord[];
}

export async function getSensorById(id: string): Promise<SensorRecord | null> {
  const { data, error } = await supabase
    .from("sensors")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data as SensorRecord;
}

export async function createSensor(record: Partial<SensorRecord>) {
  const { error } = await supabase.from("sensors").insert(record);
  if (error) throw error;
}

export async function updateSensor(id: string, record: Partial<SensorRecord>) {
  const { error } = await supabase
    .from("sensors")
    .update(record)
    .eq("id", id);

  if (error) throw error;
}