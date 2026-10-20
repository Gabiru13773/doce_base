// Marcador provisório: a tela de importação do extrato (OFX) está sendo feita em paralelo.
import EmBrevePage from '../../embreve/EmBrevePage'

export default function ImportarOfxPage() {
  return (
    <EmBrevePage
      titulo="Importar extrato"
      itens={['Trazer as movimentações do banco a partir do arquivo OFX, sem digitar uma por uma']}
    />
  )
}
