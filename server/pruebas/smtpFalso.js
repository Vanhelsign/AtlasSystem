// SMTP mínimo para pruebas: responde según el modo ('acepta', 'rechaza' el destinatario o 'mudo', sin saludo).
import { createServer } from 'node:net'

export async function smtpFalso(modoInicial) {
  const recibidos = []
  const control = { modo: modoInicial }
  const servidor = createServer((socket) => {
    if (control.modo === 'mudo') return
    let enDatos = false
    let datos = ''
    let pendiente = ''
    socket.write('220 smtp.falso ESMTP\r\n')
    socket.on('data', (trozo) => {
      pendiente += trozo.toString('utf8')
      if (enDatos) {
        const fin = pendiente.indexOf('\r\n.\r\n')
        if (fin === -1) return
        datos += pendiente.slice(0, fin)
        pendiente = pendiente.slice(fin + 5)
        enDatos = false
        recibidos.push(datos)
        socket.write('250 2.0.0 Aceptado\r\n')
      }
      let salto
      while (!enDatos && (salto = pendiente.indexOf('\r\n')) !== -1) {
        const linea = pendiente.slice(0, salto)
        pendiente = pendiente.slice(salto + 2)
        const comando = linea.slice(0, 4).toUpperCase()
        if (comando === 'EHLO' || comando === 'HELO') socket.write('250 smtp.falso\r\n')
        else if (comando === 'MAIL') socket.write('250 OK\r\n')
        else if (comando === 'RCPT') socket.write(control.modo === 'rechaza' ? '550 5.1.1 Buzón inexistente\r\n' : '250 OK\r\n')
        else if (comando === 'DATA') { enDatos = true; datos = ''; socket.write('354 Termina con .\r\n') }
        else if (comando === 'QUIT') { socket.write('221 Adiós\r\n'); socket.end() }
        else socket.write('250 OK\r\n')
      }
    })
  })
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  return {
    puerto: servidor.address().port,
    recibidos,
    // Cambia el comportamiento para las conexiones siguientes.
    cambiarModo: (modo) => { control.modo = modo },
    cerrar: () => new Promise((resolver) => servidor.close(resolver)),
  }
}
