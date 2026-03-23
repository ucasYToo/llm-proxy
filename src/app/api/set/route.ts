import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { readConfig, writeConfig } from "@/lib/config";
import type { Target, LogCollection } from "@/lib/types";

export const POST = async (req: NextRequest) => {
  const body = await req.json();
  const { action } = body as { action: string };
  const config = readConfig();

  switch (action) {
    case "setActive": {
      const { targetId } = body as { targetId: string };
      if (!config.targets.find((t) => t.id === targetId)) {
        return NextResponse.json({ error: "Target not found" }, { status: 404 });
      }
      config.activeTarget = targetId;
      writeConfig(config);
      return NextResponse.json({ ok: true });
    }

    case "addTarget": {
      const { target } = body as { target: Omit<Target, "id"> };
      const newTarget: Target = { id: uuidv4(), ...target };
      config.targets.push(newTarget);
      if (!config.activeTarget) config.activeTarget = newTarget.id;
      writeConfig(config);
      return NextResponse.json({ ok: true, target: newTarget });
    }

    case "updateTarget": {
      const { target } = body as { target: Target };
      const idx = config.targets.findIndex((t) => t.id === target.id);
      if (idx === -1) {
        return NextResponse.json({ error: "Target not found" }, { status: 404 });
      }
      config.targets[idx] = target;
      writeConfig(config);
      return NextResponse.json({ ok: true });
    }

    case "deleteTarget": {
      const { targetId } = body as { targetId: string };
      config.targets = config.targets.filter((t) => t.id !== targetId);
      if (config.activeTarget === targetId) {
        config.activeTarget = config.targets[0]?.id ?? "";
      }
      writeConfig(config);
      return NextResponse.json({ ok: true });
    }

    case "updateLogCollection": {
      const { logCollection } = body as { logCollection: LogCollection };
      config.logCollection = {
        ...config.logCollection,
        ...logCollection,
      };
      writeConfig(config);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
};
