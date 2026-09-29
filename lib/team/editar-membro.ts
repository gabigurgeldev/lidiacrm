/**
 * Até onde o admin de UMA empresa pode mexer na conta de uma pessoa da equipe.
 *
 * A conta (e-mail, senha) é da INSTALAÇÃO, não da empresa: a mesma pessoa pode
 * trabalhar em duas empresas do mesmo servidor com um login só. Se o admin da
 * empresa A pudesse trocar a senha dela, ele entraria na empresa B — tomada de
 * conta entre clientes. Por isso:
 *
 *   - e-mail e senha só mudam quando a pessoa está SÓ nesta empresa;
 *   - quem administra a plataforma nunca é editado por uma empresa;
 *   - a própria conta se edita em "Minha conta", não aqui.
 *
 * O nome pode mudar sempre: não dá acesso a nada.
 */

export interface Recusa {
  status: 403 | 409;
  motivo: "propria_conta" | "admin_da_plataforma" | "outra_empresa";
  message: string;
}

export function recusaDeEdicaoDoMembro(p: {
  atorId: string;
  alvoId: string;
  alvoEhPlatformAdmin: boolean;
  outrasEmpresasAtivas: number;
  mudaAcesso: boolean;
}): Recusa | null {
  if (p.atorId === p.alvoId) {
    return {
      status: 409,
      motivo: "propria_conta",
      message: "Para mudar os seus próprios dados, use Minha conta.",
    };
  }
  if (p.alvoEhPlatformAdmin) {
    return {
      status: 403,
      motivo: "admin_da_plataforma",
      message: "Esta pessoa administra a plataforma e só pode ser editada pelo painel da plataforma.",
    };
  }
  if (p.mudaAcesso && p.outrasEmpresasAtivas > 0) {
    return {
      status: 409,
      motivo: "outra_empresa",
      message:
        "Esta pessoa também faz parte de outra empresa com o mesmo login, então o e-mail e a senha dela só podem ser trocados por ela mesma. O nome você pode mudar.",
    };
  }
  return null;
}
