import { CreditosAxon, type EstadoPago } from "@/components/dashboard/CreditosAxon";

// Créditos de WhatsApp (tokens de Axon Logic): saldo y compra de packs. Stripe
// regresa aquí con ?pago=ok|cancelado; se lee en el servidor para no necesitar
// useSearchParams (y su Suspense) en el cliente.

type Props = { searchParams: Promise<{ pago?: string | string[] }> };

export default async function CreditosAxonPage({ searchParams }: Props) {
  const { pago } = await searchParams;
  const estado: EstadoPago = pago === "ok" ? "ok" : pago === "cancelado" ? "cancelado" : null;
  return <CreditosAxon pago={estado} />;
}
