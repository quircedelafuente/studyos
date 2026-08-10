"use client";

import { useEffect, useRef } from "react";
import { useCloudSyncStatus } from "@/components/providers/CloudSyncProvider";
import {
  backfillSeedSubjectsOnce,
  migrateSeedColorsOnce,
  seedSemesterExamsOnce,
} from "@/lib/semester-exams-seed";

/**
 * Siembra las fechas evaluables del semestre en «Exámenes y fechas».
 *
 * Espera a que termine la sincronización inicial: si sembrara antes, el estado
 * de la nube podría sobrescribir lo recién añadido, o se duplicaría con lo que
 * ya hubiera sembrado otro dispositivo. Una vez `initialSyncDone` es true, el
 * localStorage ya refleja la nube y el sembrado es seguro.
 */
export function SemesterExamsSeeder() {
  const sync = useCloudSyncStatus();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    // `cloudEnabled === false` = sin nube configurada; sembramos igualmente en local.
    const ready = sync?.initialSyncDone === true || sync?.cloudEnabled === false;
    if (!ready) return;
    done.current = true;
    const added = seedSemesterExamsOnce();
    if (added > 0) {
      console.log(`[exams-seed] ${added} fechas del semestre añadidas al calendario`);
    }
    const recolored = migrateSeedColorsOnce();
    if (recolored > 0) {
      console.log(`[exams-seed] ${recolored} eventos recoloreados`);
    }
    const subjects = backfillSeedSubjectsOnce();
    if (subjects > 0) {
      console.log(`[exams-seed] ${subjects} fechas con asignatura asignada`);
    }
  }, [sync?.initialSyncDone, sync?.cloudEnabled]);

  return null;
}
