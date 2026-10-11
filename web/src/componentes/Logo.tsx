export function Logo({ grande = false }: { grande?: boolean }) {
  return (
    <div className={grande ? 'logo logo-grande' : 'logo'}>
      <img src="/icone.svg" alt="" width={grande ? 48 : 32} height={grande ? 48 : 32} />
      <span>
        Ozamigos <strong>Share</strong>
      </span>
    </div>
  );
}
