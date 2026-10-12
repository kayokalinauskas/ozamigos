/** O logotipo: "O" e "Z" em teclas de teclado gamer, seguidos de "amigos" (o mesmo desenho do ícone). */
export function Logo({ grande = false }: { grande?: boolean }) {
  return (
    <div className={grande ? 'logo logo-grande' : 'logo'}>
      <span className="so-para-leitores">Ozamigos</span>
      <span className="tecla" aria-hidden="true">
        O
      </span>
      <span className="tecla" aria-hidden="true">
        Z
      </span>
      <span aria-hidden="true">amigos</span>
    </div>
  );
}
