if(new URLSearchParams(location.search).get('speech')==='1'){
  await import('./speech-window.js');
}else{
  await import('./pet.js');
}
