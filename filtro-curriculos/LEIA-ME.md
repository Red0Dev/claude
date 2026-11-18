# Filtro de candidatos Catho — PudiMarin

Script do Tampermonkey que funciona na área de empresa da Catho. **Todo dia**, no horário que você
escolher, ele faz isto sozinho:

1. abre **Minhas vagas** e entra nos candidatos de **Auxiliar de Cozinha** e de **Atendente de Delivery**,
   passando por todas as páginas;
2. lê a cidade e o bairro de cada candidato (exemplo: "São Bernardo do Campo, SP - Jardim da represa");
3. pergunta ao Google quanto tempo leva **de ônibus** do bairro até a loja da vaga, num dia útil às 8h;
4. se der até **45 minutos**, dá **👍** em "Avalie", abre **contatos** para pegar o WhatsApp e **avisa
   você** com uma notificação no Windows.

Quem já tem avaliação (👍 ou 👎 dado por você) fica de fora: o script não mexe. Também não dá 👍 duas
vezes na mesma pessoa.

## Lojas

| Vaga | Loja | Endereço |
|---|---|---|
| Auxiliar de Cozinha | Rudge Ramos | Av. Min. Osvaldo Aranha, 232 - Loja 4 - Vila Franca, São Bernardo do Campo - SP, 09626-000 |
| Atendente de Delivery | Vergueiro | Av. Senador Vergueiro, 2123 - Lj 1 - Rudge Ramos, São Bernardo do Campo - SP, 09726-253 |
| Atendente de Delivery | Nova Petrópolis | Av. Francisco Prestes Maia, 957 - Lj 14 - Centro, São Bernardo do Campo - SP, 09770-000 |

O candidato a atendente é comparado com as duas lojas e fica com a mais perto.

## 1. Instalar (uma vez)

Com o Tampermonkey já instalado no navegador, abra este link e clique em **Instalar** (ou **Atualizar**):

https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/filtro-curriculos/filtro-catho.user.js

## 2. Criar a chave do Google (uma vez, uns 10 minutos)

O cálculo de ônibus é feito pelo Google Maps. Para isso, você precisa de uma chave sua.

1. Entre em https://console.cloud.google.com com sua conta Google e crie um projeto (por exemplo, "Filtro Catho").
2. Em **Faturamento**, vincule um cartão. O Google oferece uma cota grátis por mês, e cada
   candidato usa 1 consulta (cozinha) ou 2 (atendente), só na primeira vez que aparece.
3. Em **APIs e serviços → Biblioteca**, procure **Routes API** e clique em **Ativar**.
4. Em **APIs e serviços → Credenciais**, clique em **Criar credenciais → Chave de API**.
5. Abra a chave criada. Em **Restrições de API**, escolha **Restringir chave**, marque só a
   **Routes API** e salve.
6. Recomendado: em **Faturamento → Orçamentos e alertas**, crie um alerta de valor baixo (por exemplo, R$ 10).
   Assim você recebe um aviso se a conta passar disso.
7. Copie a chave (começa com `AIza…`). Na Catho, abra o painel do filtro, vá em **⚙ Ajustes** e cole a chave em **Chave Google**.

## 3. Primeira verificação (conferência)

1. Entre na Catho, na área da empresa, e clique em **Verificar agora** no painel **🍮 Filtro PudiMarin**,
   no canto de baixo da tela.
2. Abre uma aba nova, que vai sozinha para as vagas e os candidatos.
3. Na primeira vez, **antes de clicar**, ele marca com um quadrado vermelho o 👍 de quem está perto e pergunta
   se está certo.
   - Se o quadrado estiver mesmo no 👍 dessas pessoas, clique em **Sim, pode dar 👍**. Daí em diante ele faz isso sozinho.
   - Se estiver errado, clique em **Não, está errado**. Depois clique em **Diagnóstico** e cole o resultado
     no chat com o Claude.

## 4. Todo dia

- A verificação roda no horário de **⚙ Ajustes → Verificar todo dia** (o padrão é 9h).
- Para isso, o **navegador precisa estar aberto com alguma aba da Catho**. Deixe uma aba fixada
  com "Minhas vagas". Se o computador estiver desligado no horário, a verificação roda assim que
  você abrir a Catho de novo naquele dia.
- Ela acontece numa aba que abre e fecha sozinha. No fim chega a notificação
  **"Catho: N candidatos perto, com 👍"**, com nome, vaga, loja, tempo de ônibus e WhatsApp.
- Se algo der errado (por exemplo, a Catho pedir login de novo), chega uma notificação dizendo o
  que houve. Ele tenta de novo 2 horas depois.

## O painel

- **Até 45 min**: quem está perto, com a loja, o tempo de ônibus e o WhatsApp (o link abre a conversa).
  "👍 18/11" quer dizer que o filtro deu o like nesse dia. "já avaliado" quer dizer que você já tinha avaliado a pessoa.
- **Longe**: passou do limite.
- **Pendentes**: falta alguma coisa. Pode ser o bairro (só aparece a cidade) ou a vaga não identificada,
  e aí aparecem botões para escolher.
- **Copiar lista**: copia o resultado pronto para colar no WhatsApp (nome, vaga, endereço da loja e WhatsApp).
- **Baixar planilha**: baixa tudo em CSV, que abre no Excel.
- **⚙ Ajustes**: chave do Google, limite (minutos ou km), horário diário e se deve abrir "contatos".

Quando você mesmo abre os candidatos de uma vaga, o painel também mostra o tempo de ônibus deles.
A vaga é reconhecida pelo título da página.

## Se algo não funcionar

A Catho pode mostrar os dados de um jeito que o script ainda não conhece. Nesse caso:

1. deixe aberta a página onde ele parou;
2. clique em **Diagnóstico** no painel;
3. cole o resultado no chat com o Claude.

O diagnóstico copia só a estrutura da página. Nomes, telefones e endereços saem trocados por `xxxx` e `9999`.
