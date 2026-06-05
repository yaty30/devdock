import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSection,
  DatabaseConnection,
  DatabaseExecutionRecord,
  DatabaseWorkspaceTab,
} from "../../types";
import type { SnackbarTone } from "../../types/snackbar";
import type { DatabaseRuntimeStatus } from "./DatabaseHeaderActions";

const DATABASE_IDLE_DISCONNECT_MS = 2 * 60 * 1000;

type DatabaseConnectionModalMode = "add" | "edit" | null;

export function useDatabaseController({
  activeSection,
  setActiveSection,
  requestSettingsNavigation,
  showSnackbar,
}: {
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
  requestSettingsNavigation: (action: () => void) => void;
  showSnackbar: (message: string, tone: SnackbarTone) => void;
}) {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [connectionModal, setConnectionModal] =
    useState<DatabaseConnectionModalMode>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);
  const [deleteConnectionRequest, setDeleteConnectionRequest] =
    useState<DatabaseConnection | null>(null);
  const [deletedConnectionId, setDeletedConnectionId] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] =
    useState<DatabaseWorkspaceTab>("connection");
  const [executionHistory, setExecutionHistory] = useState<
    DatabaseExecutionRecord[]
  >([]);
  const [lastRefreshTime, setLastRefreshTime] = useState(() =>
    new Date().toISOString(),
  );
  const [runtimeStatus, setRuntimeStatus] =
    useState<DatabaseRuntimeStatus>("idle");
  const sleepTimerRef = useRef<number | null>(null);
  const hadConnectionRef = useRef(false);
  const selectedConnectionIdRef = useRef<string | null>(null);
  const verifyingConnectionIdRef = useRef<string | null>(null);

  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ??
    connections[0] ??
    null;
  const selectedExecutionHistory = useMemo(
    () =>
      selectedConnection
        ? executionHistory.filter(
            (entry) => entry.connectionId === selectedConnection.id,
          )
        : [],
    [executionHistory, selectedConnection],
  );

  useEffect(() => {
    selectedConnectionIdRef.current = selectedConnectionId;
  }, [selectedConnectionId]);

  useEffect(() => {
    return () => {
      if (sleepTimerRef.current !== null) {
        window.clearTimeout(sleepTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hasConnection = Boolean(selectedConnectionId);
    if (!hasConnection) {
      hadConnectionRef.current = false;
      if (sleepTimerRef.current !== null) {
        window.clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
      setRuntimeStatus("idle");
      return;
    }

    const selected = connections.find(
      (connection) => connection.id === selectedConnectionId,
    );
    if (
      selected?.status === "error" &&
      verifyingConnectionIdRef.current !== selected.id
    ) {
      if (sleepTimerRef.current !== null) {
        window.clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
      setRuntimeStatus("error");
      return;
    }
    if (selected?.status === "disconnected") {
      if (sleepTimerRef.current !== null) {
        window.clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
      setRuntimeStatus("disconnected");
      return;
    }

    if (activeSection === "database") {
      if (sleepTimerRef.current !== null) {
        window.clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
      setRuntimeStatus((current) => {
        if (current === "connected") {
          return current;
        }
        if (current === "sleeping" || current === "disconnected") {
          return "reconnecting";
        }
        return hadConnectionRef.current ? "reconnecting" : "connecting";
      });
      return;
    }

    setRuntimeStatus((current) =>
      current === "connected" ||
      current === "connecting" ||
      current === "reconnecting"
        ? "sleeping"
        : current,
    );
    if (sleepTimerRef.current !== null) {
      window.clearTimeout(sleepTimerRef.current);
    }
    sleepTimerRef.current = window.setTimeout(() => {
      sleepTimerRef.current = null;
      setRuntimeStatus("disconnected");
    }, DATABASE_IDLE_DISCONNECT_MS);
  }, [activeSection, selectedConnectionId, connections]);

  useEffect(() => {
    if (
      activeSection !== "database" ||
      !selectedConnectionId ||
      (runtimeStatus !== "connecting" && runtimeStatus !== "reconnecting")
    ) {
      return;
    }

    let cancelled = false;
    const connectTimer = window.setTimeout(() => {
      if (!cancelled) {
        hadConnectionRef.current = true;
        setRuntimeStatus("connected");
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(connectTimer);
    };
  }, [activeSection, selectedConnectionId, runtimeStatus]);

  function hydrateConnections(
    nextConnections: DatabaseConnection[],
    nextExecutionHistory: DatabaseExecutionRecord[],
  ): void {
    const hydratedConnections: DatabaseConnection[] = nextConnections.map(
      (connection) => ({
        ...connection,
        status: connection.autoConnect ? "connected" : "disconnected",
      }),
    );
    const autoConnectConnection = hydratedConnections.find(
      (connection) => connection.autoConnect,
    );
    setConnections(hydratedConnections);
    setExecutionHistory(nextExecutionHistory);
    setSelectedConnectionId(
      autoConnectConnection?.id ?? hydratedConnections[0]?.id ?? null,
    );
  }

  function switchConnection(connection: DatabaseConnection): void {
    const doSwitch = (): void => {
      selectedConnectionIdRef.current = connection.id;
      setSelectedConnectionId(connection.id);
      setConnections((current) =>
        current.map((item) =>
          item.id === connection.id
            ? {
                ...item,
                status: item.status === "error" ? "error" : "connected",
              }
            : item,
        ),
      );
      setActiveTab("connection");
      setActiveSection("database");
    };

    requestSettingsNavigation(doSwitch);
  }

  function connectConnection(connection: DatabaseConnection): void {
    if (sleepTimerRef.current !== null) {
      window.clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    selectedConnectionIdRef.current = connection.id;
    setSelectedConnectionId(connection.id);
    setActiveTab("connection");
    setActiveSection("database");
    void verifyConnection(connection, {
      persistAutoConnect: true,
      showSuccess: true,
    });
  }

  async function verifyConnection(
    connection: DatabaseConnection,
    options: { persistAutoConnect: boolean; showSuccess: boolean },
  ): Promise<void> {
    verifyingConnectionIdRef.current = connection.id;
    hadConnectionRef.current = true;
    setRuntimeStatus((current) =>
      current === "connected" || current === "sleeping"
        ? "reconnecting"
        : "connecting",
    );

    try {
      const result =
        await window.ivsDashboard.testDatabaseConnection(connection);
      if (!result.success) {
        if (verifyingConnectionIdRef.current === connection.id) {
          verifyingConnectionIdRef.current = null;
        }
        applyConnectionStatus(connection, "error");
        if (selectedConnectionIdRef.current === connection.id) {
          setRuntimeStatus("error");
        }
        showSnackbar(
          result.message || "Database connection failed.",
          "invalid",
        );
        if (options.persistAutoConnect) {
          await saveConnectionRuntimeStatus(connection, "error", false);
        }
        return;
      }

      applyConnectionStatus(connection, "connected");
      if (verifyingConnectionIdRef.current === connection.id) {
        verifyingConnectionIdRef.current = null;
      }
      if (selectedConnectionIdRef.current === connection.id) {
        setRuntimeStatus("connected");
      }
      if (options.showSuccess) {
        showSnackbar(`${connection.name} connected.`, "valid");
      }
      if (options.persistAutoConnect) {
        await saveConnectionRuntimeStatus(connection, "connected", true);
      }
    } catch (error) {
      if (verifyingConnectionIdRef.current === connection.id) {
        verifyingConnectionIdRef.current = null;
      }
      const message =
        error instanceof Error ? error.message : "Database connection failed.";
      applyConnectionStatus(connection, "error");
      if (selectedConnectionIdRef.current === connection.id) {
        setRuntimeStatus("error");
      }
      showSnackbar(message, "invalid");
      if (options.persistAutoConnect) {
        await saveConnectionRuntimeStatus(connection, "error", false);
      }
    }
  }

  function applyConnectionStatus(
    connection: DatabaseConnection,
    status: DatabaseConnection["status"],
  ): void {
    setConnections((current) =>
      current.map((item) =>
        item.id === connection.id ? { ...item, status } : item,
      ),
    );
  }

  async function saveConnectionRuntimeStatus(
    connection: DatabaseConnection,
    status: DatabaseConnection["status"],
    autoConnect: boolean,
  ): Promise<void> {
    try {
      const saved = await window.ivsDashboard.updateDatabaseConnectionSettings(
        connection.id,
        { autoConnect, status },
      );
      setConnections((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
    } catch (error) {
      console.error(error);
      showSnackbar("Connection setting could not be saved.", "invalid");
    }
  }

  function disconnectConnection(connection: DatabaseConnection): void {
    if (sleepTimerRef.current !== null) {
      window.clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    if (selectedConnectionId === connection.id) {
      hadConnectionRef.current = false;
      setRuntimeStatus("disconnected");
    }
    setConnections((current) =>
      current.map((item) =>
        item.id === connection.id ? { ...item, status: "disconnected" } : item,
      ),
    );
    showSnackbar(`${connection.name} disconnected.`, "warning");
    void window.ivsDashboard
      .updateDatabaseConnectionSettings(connection.id, {
        autoConnect: false,
        status: "disconnected",
      })
      .then((saved) => {
        setConnections((current) =>
          current.map((item) => (item.id === saved.id ? saved : item)),
        );
      })
      .catch((error) => {
        console.error(error);
        showSnackbar("Connection setting could not be saved.", "invalid");
      });
  }

  function openAddConnection(): void {
    setActiveSection("database");
    setConnectionModal("add");
  }

  function openConnectionSettings(): void {
    if (!selectedConnection) {
      showSnackbar("Select a database connection first.", "invalid");
      return;
    }

    setConnectionModal("edit");
  }

  async function saveConnection(
    savedConnection: DatabaseConnection,
  ): Promise<boolean> {
    try {
      const persisted =
        await window.ivsDashboard.saveDatabaseConnection(savedConnection);
      if (connectionModal === "add") {
        setConnections((current) => [...current, persisted]);
        setSelectedConnectionId(persisted.id);
        setActiveTab("connection");
        setActiveSection("database");
        setConnectionModal(null);
        showSnackbar("Connection saved", "valid");
        return true;
      }

      setConnections((current) =>
        current.map((connection) =>
          connection.id === persisted.id
            ? {
                ...connection,
                ...persisted,
                name: persisted.name || connection.name,
              }
            : connection,
        ),
      );
      setSelectedConnectionId(persisted.id);
      setConnectionModal(null);
      showSnackbar("Connection settings saved", "valid");
      return true;
    } catch (error) {
      console.error(error);
      showSnackbar(
        error instanceof Error
          ? error.message
          : "Connection could not be saved",
        "invalid",
      );
      return false;
    }
  }

  async function confirmDeleteConnection(): Promise<void> {
    if (!deleteConnectionRequest) {
      return;
    }

    const deleted = deleteConnectionRequest;
    try {
      await window.ivsDashboard.deleteDatabaseConnection(deleted.id);
      const remaining = connections.filter(
        (connection) => connection.id !== deleted.id,
      );
      setConnections(remaining);
      setDeletedConnectionId(deleted.id);
      setDeleteConnectionRequest(null);
      setExecutionHistory((current) =>
        current.filter((entry) => entry.connectionId !== deleted.id),
      );
      if (selectedConnectionId === deleted.id) {
        setSelectedConnectionId(remaining[0]?.id ?? null);
        setActiveTab("connection");
        if (remaining.length === 0) {
          setActiveSection("database");
        }
      }
      showSnackbar(`${deleted.name} deleted.`, "valid");
    } catch (error) {
      console.error(error);
      showSnackbar(
        error instanceof Error
          ? error.message
          : "Connection could not be deleted",
        "invalid",
      );
    }
  }

  function handleExecution(record: DatabaseExecutionRecord): void {
    setExecutionHistory((current) => {
      const countsByConnection = new Map<string, number>();
      return [record, ...current].filter((entry) => {
        const count = countsByConnection.get(entry.connectionId) ?? 0;
        if (count >= 1000) {
          return false;
        }
        countsByConnection.set(entry.connectionId, count + 1);
        return true;
      });
    });
  }

  function refreshMetadata(): void {
    setLastRefreshTime(new Date().toISOString());
    showSnackbar("Database metadata refreshed.", "valid");
  }

  return {
    activeTab,
    connectionModal,
    connections,
    deletedConnectionId,
    deleteConnectionRequest,
    lastRefreshTime,
    runtimeStatus,
    selectedConnection,
    selectedConnectionId,
    selectedExecutionHistory,
    closeConnectionModal: () => setConnectionModal(null),
    confirmDeleteConnection,
    connectConnection,
    disconnectConnection,
    handleExecution,
    hydrateConnections,
    openAddConnection,
    openConnectionSettings,
    refreshMetadata,
    requestDeleteConnection: (connection: DatabaseConnection) => {
      setConnectionModal(null);
      setDeleteConnectionRequest(connection);
    },
    saveConnection,
    setActiveTab,
    setDeleteConnectionRequest,
    switchConnection,
  };
}
