"use client";

import { useRef, useState } from "react";
import type { Connection, OneByOneResult, OneByOneSummary } from "../types";

const ONE_BY_ONE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UseOneByOneTestArgs {
  connections: Connection[];
}

export function useOneByOneTest({ connections }: UseOneByOneTestArgs) {
  const [oneByOneRunning, setOneByOneRunning] = useState<boolean>(false);
  const [oneByOneStopping, setOneByOneStopping] = useState<boolean>(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState<string | null>(null);
  const [oneByOneResults, setOneByOneResults] = useState<Record<string, OneByOneResult>>({});
  const [oneByOneSummary, setOneByOneSummary] = useState<OneByOneSummary | null>(null);
  const stopOneByOneRef = useRef<boolean>(false);

  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;

    const queuedState = Object.fromEntries(
      connections.map((connection) => [connection.id, { state: "queued", error: null }]),
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });

    let passed = 0;
    let failed = 0;

    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: connections.length,
            completed: index,
            passed,
            failed,
            stopped: true,
          });
          break;
        }

        const connection = connections[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null },
        }));

        try {
          const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
          const data = await res.json();
          const valid = !!data.valid;

          if (valid) {
            passed += 1;
          } else {
            failed += 1;
          }

          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: valid ? "success" : "failed",
              error: valid ? null : (data.error || null),
            },
          }));
        } catch (error: unknown) {
          failed += 1;
          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: "failed",
              error: error instanceof Error ? error.message : "Test failed",
            },
          }));
        }

        setOneByOneSummary({
          total: connections.length,
          completed: index + 1,
          passed,
          failed,
          stopped: false,
        });

        if (index < connections.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      setOneByOneCurrentConnectionId(null);
      setOneByOneRunning(false);
      setOneByOneStopping(false);
      stopOneByOneRef.current = false;
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  return {
    oneByOneRunning,
    oneByOneStopping,
    oneByOneCurrentConnectionId,
    oneByOneResults,
    oneByOneSummary,
    handleRunOneByOneTest,
    handleStopOneByOneTest,
  };
}

export type UseOneByOneTestReturn = ReturnType<typeof useOneByOneTest>;
