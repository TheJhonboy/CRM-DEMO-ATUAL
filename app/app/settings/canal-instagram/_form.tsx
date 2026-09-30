"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";

/**
 * Conectar uma conta de Instagram (mensagens diretas) — tela do operador.
 *
 * ─── O que esta tela não pode fazer ─────────────────────────────────────────
 *
 * Fingir saúde. "Não conectado" é um estado com nome próprio e explica a
 * consequência (nenhuma mensagem chega), e "token inválido" não cai em
 * "conectado" só porque existe uma linha gravada. Quando a Meta não responde ao
 * teste, a tela diz que NÃO testou — e não que está tudo bem.
 *
 * ─── Conectar são DUAS pontas ───────────────────────────────────────────────
 *
 * Os dados colados aqui deixam o CRM FALAR com a Meta. A URL e o verify token
 * abaixo deixam a Meta FALAR com o CRM. Quem faz só a primeira envia e nunca
 * recebe — por isso os dois valores ficam visíveis, com botão de copiar, também
 * depois de conectar.
 *
 * O token e o segredo do app NUNCA voltam do servidor: o campo limpa assim que a
 * conexão é gravada e, com conta conectada, só diz que já existe um valor.
 */

type EstadoDaConexao = "conectado" | "nao_conectado" | "token_invalido";

interface Estado {
  state: EstadoDaConexao;
  health: "ok" | "falhou" | "sem_resposta" | "credencial_indisponivel" | null;
  username: string | null;
  webhookUrl: string | null;
  verifyToken: string | null;
}

interface Conectado {
  webhookUrl: string;
  verifyToken: string;
  username: string | null;
  status: string;
  /** `false` = a assinatura automática do campo `messages` não foi confirmada pela Meta. */
  webhookSubscribed?: boolean;
}

/** Campo somente-leitura com botão de copiar — o que o operador cola na Meta. */
function ParaColar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <code
          className="min-h-11 min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2.5 text-xs"
          data-testid="valor-para-colar"
        >
          {valor}
        </code>
        <Button
          variant="outline"
          onClick={async () => {
            const copiou = await copyToClipboard(valor);
            if (copiou) toast.success(t("Copiado."));
            else toast.error(t("Não foi possível copiar. Selecione o texto e copie à mão."));
          }}
          aria-label={`${t("Copiar")}: ${rotulo}`}
        >
          {t("Copiar")}
        </Button>
      </div>
    </div>
  );
}

function SeloDoEstado({ estado }: { estado: EstadoDaConexao }) {
  const t = useT();
  if (estado === "conectado") return <Badge variant="success">{t("Conectado")}</Badge>;
  if (estado === "token_invalido") return <Badge variant="error">{t("Token inválido")}</Badge>;
  return <Badge variant="outline">{t("Não conectado")}</Badge>;
}

export function CanalInstagramForm() {
  const t = useT();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [testando, setTestando] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recemConectado, setRecemConectado] = useState<Conectado | null>(null);

  const carregar = useCallback(async (): Promise<Estado | null> => {
    try {
      const r = await apiClient.get<{ data: Estado }>("/api/v1/channels/instagram");
      setEstado(r.data);
      return r.data;
    } catch {
      // Falha de leitura não trava a tela: o formulário continua servindo.
      setEstado(null);
      return null;
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const conectar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const r = await apiClient.post<{ data: Conectado }>("/api/v1/channels/instagram", {
        accountId: accountId.trim(),
        accessToken: accessToken.trim(),
        appSecret: appSecret.trim(),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      setRecemConectado(r.data);
      // Token e segredo saem da memória da tela assim que são gravados: não voltam
      // do servidor, e deixá-los no campo só cria uma cópia a mais.
      setAccessToken("");
      setAppSecret("");
      toast.success(t("Canal conectado."));
      await carregar();
    } catch (e) {
      const mensagem = e instanceof Error ? t(e.message) : t("Não foi possível conectar.");
      setErro(mensagem);
      toast.error(mensagem);
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    const novo = await carregar();
    setTestando(false);
    if (!novo) {
      toast.error(t("Não foi possível testar agora. Tente de novo."));
    } else if (novo.state === "token_invalido") {
      toast.error(t("A Meta recusou o token. Conecte de novo com um token novo."));
    } else if (novo.state === "conectado" && novo.health === "ok") {
      toast.success(t("Conexão funcionando."));
    } else if (novo.state === "conectado") {
      toast.error(t("A Meta não respondeu ao teste. Tente de novo em instantes."));
    }
  };

  const conectado = estado?.state === "conectado" || estado?.state === "token_invalido";
  const estadoAtual: EstadoDaConexao = estado?.state ?? "nao_conectado";
  const webhookUrl = recemConectado?.webhookUrl ?? estado?.webhookUrl ?? null;
  const verifyToken = recemConectado?.verifyToken ?? estado?.verifyToken ?? null;
  const pronto = accountId.trim() !== "" && accessToken.trim() !== "" && appSecret.trim() !== "";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t("Estado da conexão")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("Mensagens diretas do Instagram entram e saem pelo CRM, atendidas pela sua equipe e pelo agente de IA.")}
            </p>
          </div>
          {carregando ? (
            <Badge variant="outline">{t("Verificando…")}</Badge>
          ) : (
            <SeloDoEstado estado={estadoAtual} />
          )}
        </div>

        {!carregando && estadoAtual === "nao_conectado" && (
          <div
            role="status"
            className="rounded-md border border-border bg-muted/40 p-3 text-sm"
            data-testid="aviso-nao-conectado"
          >
            <p className="font-medium">{t("Nenhuma conta do Instagram conectada.")}</p>
            <p className="text-xs text-muted-foreground">
              {t("Enquanto isso, nenhuma mensagem do Instagram chega ao CRM. Siga os passos abaixo para conectar.")}
            </p>
          </div>
        )}

        {!carregando && estadoAtual === "token_invalido" && (
          <div
            role="alert"
            className="rounded-md border border-error/40 bg-error-bg p-3 text-sm"
            data-testid="aviso-token-invalido"
          >
            <p className="font-medium">{t("A Meta recusou o token desta conta.")}</p>
            <p className="text-xs text-muted-foreground">
              {t("As respostas não saem até você gerar um token novo e conectar de novo, abaixo.")}
            </p>
          </div>
        )}

        {!carregando && estadoAtual === "conectado" && estado?.health === "sem_resposta" && (
          <div role="status" className="rounded-md border border-warning/40 bg-warning-bg p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {t("A Meta não respondeu ao teste agora. O estado mostrado é o da última conexão, não de um teste.")}
            </p>
          </div>
        )}

        {!carregando && estadoAtual === "conectado" && estado?.health === "credencial_indisponivel" && (
          <div role="status" className="rounded-md border border-warning/40 bg-warning-bg p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {t("Não foi possível ler a credencial gravada agora. Tente de novo em instantes.")}
            </p>
          </div>
        )}

        {conectado && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {estado?.username ? `@${estado.username}` : t("Conta conectada")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("Token e segredo ficam guardados cifrados e não são mostrados de novo.")}
              </p>
            </div>
            <Button variant="outline" onClick={testar} disabled={testando}>
              {testando ? t("Testando…") : t("Testar conexão")}
            </Button>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">{t("Passo a passo")}</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>
            <strong>{t("Crie um app na Meta.")}</strong>{" "}
            {t("Em developers.facebook.com, crie um app do tipo Empresa e adicione o produto Instagram API with Instagram Login. Não é o Facebook Login: nenhuma Página do Facebook é necessária.")}
          </li>
          <li>
            <strong>{t("Prepare a conta.")}</strong>{" "}
            {t("A conta do Instagram precisa ser profissional (Empresa ou Criador), com o acesso às mensagens liberado nas configurações do Instagram. Enquanto o app estiver em modo de desenvolvimento, adicione essa conta como testadora do app.")}
          </li>
          <li>
            <strong>{t("Gere o token do Instagram.")}</strong>{" "}
            {t("No painel do app, em Instagram API with Instagram Login, gere o token de acesso da conta com as permissões instagram_business_basic e instagram_business_manage_messages.")}
          </li>
          <li>
            <strong>{t("Pegue os três dados.")}</strong>{" "}
            {t("O ID da conta do Instagram, o token gerado no passo anterior e o segredo do app (Configurações do app › Básico): use o segredo do mesmo app.")}
          </li>
          <li>
            <strong>{t("Cole aqui e conecte.")}</strong>{" "}
            {t("O CRM testa o token na Meta antes de gravar e tenta assinar o campo messages sozinho. Se o ID não for o da conta do token, a conexão é recusada.")}
          </li>
          <li>
            <strong>{t("Ligue a volta.")}</strong>{" "}
            {t("Cole a URL e o verify token abaixo no webhook do app. Se a tela avisar que a assinatura não foi confirmada, assine o campo messages no painel do app. Sem isso o CRM envia, mas não recebe.")}
          </li>
        </ol>
        <p
          role="note"
          className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="nota-modo-teste"
        >
          {t("Com o modo de teste do CRM ativo a IA não responde no Instagram (o contato não tem telefone liberado); ative o go-live para testar.")}
        </p>
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <h2 className="text-sm font-semibold">
          {conectado ? t("Trocar os dados da conexão") : t("Dados da conta")}
        </h2>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pronto && !salvando) void conectar();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-conta">{t("ID da conta do Instagram")}</Label>
            <Input
              id="ig-conta"
              className="h-11"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              inputMode="numeric"
              placeholder={t("só números, 5 a 32 dígitos")}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-token">{t("Token de acesso")}</Label>
            <Input
              id="ig-token"
              className="h-11"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={conectado ? t("gravado — preencha para trocar") : t("cole o token")}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-segredo">{t("Segredo do app")}</Label>
            <Input
              id="ig-segredo"
              className="h-11"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={conectado ? t("gravado — preencha para trocar") : t("cole o segredo do app")}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {t("É com ele que o CRM confere que cada mensagem recebida veio mesmo da Meta.")}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-nome">{t("Nome de exibição (opcional)")}</Label>
            <Input
              id="ig-nome"
              className="h-11"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              autoComplete="off"
            />
          </div>

          {erro && (
            <p role="alert" className="text-sm text-error-fg" data-testid="erro-conectar">
              {erro}
            </p>
          )}

          <div>
            <Button type="submit" disabled={salvando || !pronto} className="w-full sm:w-auto">
              {salvando ? t("Verificando…") : conectado ? t("Reconectar") : t("Conectar")}
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("O token é testado na Meta antes de ser gravado.")}
            </p>
          </div>
        </form>
      </Card>

      {webhookUrl && verifyToken && (
        <Card
          className={
            recemConectado
              ? "flex flex-col gap-4 border-warning/40 bg-warning-bg p-4"
              : "flex flex-col gap-4 p-4"
          }
        >
          <div>
            <h2 className="text-sm font-semibold">
              {recemConectado ? t("Falta ligar a volta") : t("Webhook")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("Cole os dois valores no webhook do app na Meta e assine o campo messages. Sem isso o CRM")}{" "}
              <strong>{t("envia mas não recebe")}</strong>
              {t(": a resposta do cliente não chega, e nada na tela avisa.")}
            </p>
          </div>
          {recemConectado?.webhookSubscribed === false && (
            <p role="alert" className="text-sm" data-testid="aviso-assinar-messages">
              {t("A assinatura automática não foi confirmada pela Meta. No painel do app, assine o campo messages do webhook do Instagram.")}
            </p>
          )}
          {recemConectado?.webhookSubscribed === true && (
            <p className="text-xs text-muted-foreground" data-testid="assinatura-ok">
              {t("O campo messages foi assinado automaticamente.")}
            </p>
          )}
          <ParaColar rotulo={t("URL de retorno")} valor={webhookUrl} />
          <ParaColar rotulo={t("Verify token")} valor={verifyToken} />
        </Card>
      )}
    </div>
  );
}
