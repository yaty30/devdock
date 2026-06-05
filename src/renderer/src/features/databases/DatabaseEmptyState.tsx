export function DatabaseEmptyState({
  onCreate,
}: {
  onCreate: () => void;
}): JSX.Element {
  return (
    <section className="database-empty-screen resizable-panel-screen">
      <div className="panel database-empty-panel">
        <DatabaseConnectionIcon />
        <h2>No database connections</h2>
        <p>Saved connections will appear in the database list.</p>
        <button
          className="button primary compact"
          type="button"
          onClick={onCreate}
        >
          New connection
        </button>
      </div>
    </section>
  );
}

function DatabaseConnectionIcon(): JSX.Element {
  return <span className="database-empty-icon">DB</span>;
}
