import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { LogIn } from "lucide-react";
import { auth, firebaseConfigured } from "../services/firebase.js";

export default function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login-screen">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await signInWithEmailAndPassword(auth, email.trim(), password);
          } catch (err) {
            setError(
              err.code === "auth/invalid-credential"
                ? "E-mail ou senha incorretos."
                : "Não foi possível entrar. Confira sua conexão e o acesso da conta.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand-mark">
          <LogIn size={24} />
        </div>
        <h1>Acesse seu espaço</h1>
        <p>
          Use sua conta autorizada para consultar e salvar os projetos da
          equipe.
        </p>
        {firebaseConfigured ? (
          <>
            <label>
              E-mail
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </>
        ) : (
          <p className="notice error">
            A conexão com o servidor ainda não foi configurada. Complete as
            variáveis públicas do Firebase ou use o modo local.
          </p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
