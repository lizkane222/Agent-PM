import { useState } from "react";
import type { Zone, ZonesMap, AccountAssignMap } from "../types/action_items";

export interface UseActionItemZonesResult {
  zones: ZonesMap;
  setZonesRaw: React.Dispatch<React.SetStateAction<ZonesMap>>;
  setZones: (updater: ((prev: ZonesMap) => ZonesMap) | ZonesMap) => void;
  accountAssign: AccountAssignMap;
  setAccountAssignRaw: React.Dispatch<React.SetStateAction<AccountAssignMap>>;
  setAccountAssign: (updater: ((prev: AccountAssignMap) => AccountAssignMap) | AccountAssignMap) => void;
  swapBoth: (oldId: string, newId: string, newZone?: Zone, newAccountKey?: string) => void;
  mergeZones: (incoming: ZonesMap) => void;
}

export function useActionItemZones(): UseActionItemZonesResult {
  const [zones, setZonesRaw] = useState<ZonesMap>(() => {
    try { return JSON.parse(localStorage.getItem("actionItemZones") ?? "{}"); } catch { return {}; }
  });

  function setZones(updater: ((prev: ZonesMap) => ZonesMap) | ZonesMap) {
    setZonesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem("actionItemZones", JSON.stringify(next));
      return next;
    });
  }

  const [accountAssign, setAccountAssignRaw] = useState<AccountAssignMap>(() => {
    try { return JSON.parse(localStorage.getItem("actionItemAccountAssign") ?? "{}"); } catch { return {}; }
  });

  function setAccountAssign(updater: ((prev: AccountAssignMap) => AccountAssignMap) | AccountAssignMap) {
    setAccountAssignRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem("actionItemAccountAssign", JSON.stringify(next));
      return next;
    });
  }

  function swapBoth(oldId: string, newId: string, newZone: Zone = "unstaged", newAccountKey?: string) {
    setZonesRaw((prev) => {
      const next = { ...prev, [newId]: newZone };
      delete next[oldId];
      localStorage.setItem("actionItemZones", JSON.stringify(next));
      return next;
    });
    setAccountAssignRaw((prev) => {
      const next = { ...prev };
      if (newAccountKey != null) next[newId] = newAccountKey;
      delete next[oldId];
      localStorage.setItem("actionItemAccountAssign", JSON.stringify(next));
      return next;
    });
  }

  function mergeZones(incoming: ZonesMap) {
    setZonesRaw((prev) => {
      const merged = { ...prev };
      for (const [id, zone] of Object.entries(incoming)) {
        if ((zone === "today" || zone === "active") && merged[id] !== zone) {
          merged[id] = zone;
        }
      }
      return merged;
    });
  }

  return {
    zones, setZonesRaw, setZones,
    accountAssign, setAccountAssignRaw, setAccountAssign,
    swapBoth, mergeZones,
  };
}
