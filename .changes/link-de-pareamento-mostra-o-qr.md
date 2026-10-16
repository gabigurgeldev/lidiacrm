---
impacto: nada_mudou
secao: corrigido
titulo: O link para o cliente conectar o WhatsApp volta a mostrar o QR Code
---

Quem abria o link de conexão de um número que tinha caído via a página com o
nome da linha e o contador correndo, mas o quadro do QR Code ficava em branco
até o link expirar.

O motivo: o WhatsApp só entrega QR para uma sessão que está esperando
leitura, e uma conexão caída fica parada em "falhou". No CRM, quem destrava
isso é o botão "Reconectar" — e o dono do celular, do outro lado do link, não
tem botão nenhum.

Agora a própria página sobe a sessão de novo quando a encontra caída (no
máximo uma vez a cada 45 segundos), mostra "Preparando o QR Code…" enquanto
isso, e o QR aparece sozinho em poucos segundos. Cada reinício feito pelo link
fica registrado na auditoria (`channel.pairing_session_restarted`).
