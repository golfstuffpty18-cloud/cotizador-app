// Única fuente de verdad de los datos "conocidos" que el sistema puede usar
// para llenar campos en blanco de un formulario (shared/fillFormFields.js).
// Si un campo pide algo que no está aquí, se deja en blanco — nunca se
// inventa. Los datos de `empresa` son los mismos ya usados en los PDF/Excel
// de cotización (shared/generateQuotePdf.js, shared/generateQuoteExcel.js).
const COMPANY_PROFILE = {
  empresa: {
    nombre: 'GS TECHNOLOGIES INVESTMENTS, S.A.',
    direccion: 'Llano Bonito, Calle Francisco Rodríguez, Casa 5285',
    telefono: '6948-1130',
    ruc: '155667603-2-2018 DV 95',
    correo: 'd.sanchezv@gstechnologiespty.com',
  },
  representante: {
    nombre: 'Ing. Dionisio Sánchez',
    cargo: 'Representante Legal',
    cedula: '6-711-815',
  },
};

module.exports = { COMPANY_PROFILE };
