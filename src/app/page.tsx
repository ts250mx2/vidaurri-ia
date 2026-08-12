import { redirect } from "next/navigation";

// El middleware manda a /login si no hay sesión; aquí solo se enruta al panel.
export default function Inicio() {
  redirect("/dashboard");
}
