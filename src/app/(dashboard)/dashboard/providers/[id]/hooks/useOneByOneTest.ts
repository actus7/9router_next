"use client";

import { useRef, useState } from "react";
import { runOneByOneTestLoop } from "./oneByOneTestRunner";
import type { Connection, OneByOneResult, OneByOneSummary } from "../types";

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

    const queuedState = Object.fromEntries(connections.map((c) => [c.id, { state: "queued", error: null }]));
    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });

    try {
      await runOneByOneTestLoop(
        connections, stopOneByOneRef,
        setOneByOneCurrentConnectionId,
        setOneByOneResults,
        setOneByOneSummary,
      );
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
    oneByOneRunning, oneByOneStopping, oneByOneCurrentConnectionId,
    oneByOneResults, oneByOneSummary, handleRunOneByOneTest, handleStopOneByOneTest,
  };
}

export type UseOneByOneTestReturn = ReturnType<typeof useOneByOneTest>;
