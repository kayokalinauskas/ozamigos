/** O logotipo: a tecla "Oz" do ícone (o mesmo desenho de public/icone.svg), seguida de "amigos". */
export function Logo({ grande = false }: { grande?: boolean }) {
  return (
    <div className={grande ? 'logo logo-grande' : 'logo'}>
      <span className="so-para-leitores">Ozamigos</span>
      <svg className="tecla-oz" viewBox="4 5 88 87" aria-hidden="true">
        <rect x="4" y="5" width="88" height="87" rx="20" fill="#b6f24a" />
        <rect x="9" y="8" width="78" height="70" rx="16" fill="#2a3326" />
        <ellipse cx="37.6" cy="41.7" rx="15" ry="17.5" fill="none" stroke="#eef9dc" strokeWidth="8.5" />
        <path d="M61 52h15.6L61 66.4h15.6" fill="none" stroke="#b6f24a" strokeWidth="4.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span aria-hidden="true">amigos</span>
    </div>
  );
}
