const menuToggle = document.querySelector('[data-menu-toggle]');
const nav = document.querySelector('[data-nav]');
if (menuToggle && nav) {
  menuToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });
}

const slides = document.querySelectorAll('.hero-image');
const nextSlide = document.querySelector('[data-next-slide]');
let slideIndex = 0;
if (slides.length && nextSlide) {
  nextSlide.addEventListener('click', () => {
    slides[slideIndex].classList.remove('is-active');
    slideIndex = (slideIndex + 1) % slides.length;
    slides[slideIndex].classList.add('is-active');
    const counter = document.querySelector('.hero-meta > span');
    if (counter) counter.innerHTML = `0${slideIndex + 1} <i></i> 0${slides.length}`;
  });
  window.setInterval(() => nextSlide.click(), 7000);
}

document.querySelectorAll('[data-demo-form]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = form.querySelector('.form-message');
    if (message) message.textContent = 'Thank you — our host will be in touch shortly.';
    else {
      const note = document.createElement('p');
      note.className = 'form-message';
      note.textContent = 'Thank you — our host will be in touch shortly.';
      form.append(note);
    }
    form.reset();
  });
});

const lightbox = document.querySelector('[data-lightbox]');
const lightboxImage = lightbox?.querySelector('img');
const lightboxClose = lightbox?.querySelector('button');
document.querySelectorAll('[data-gallery-image]').forEach((image) => {
  image.addEventListener('click', () => {
    if (!lightbox || !lightboxImage) return;
    lightboxImage.src = image.src;
    lightboxImage.alt = image.alt;
    lightbox.classList.add('open');
  });
});
lightboxClose?.addEventListener('click', () => lightbox.classList.remove('open'));
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) lightbox.classList.remove('open');
});
