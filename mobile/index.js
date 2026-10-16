// Punto de entrada: primero se carga el tema guardado (para que todos los estilos lo usen desde
// el primer cuadro) y después la app. Se usa require para garantizar ese orden.
require('./src/boot/theme');
require('expo-router/entry');
