export default function ImportWarnings({ warnings = [] }) {
  if (!warnings.length) return null;
  return (
    <div className="validation-hint import-warnings" role="note" aria-label="Alertas da importação">
      <strong>Alertas do arquivo original</strong>
      <ul>{warnings.map(w => <li key={w.code}>{w.message}</li>)}</ul>
      <p>Esses alertas se referem ao arquivo inteiro; não identificam quais peças foram afetadas.</p>
    </div>
  );
}
