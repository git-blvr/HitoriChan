const links = document.querySelectorAll(".docs-sidebar a");
const sections = document.querySelectorAll(".docs-content .panel");

function onScroll() {
  let current = "";
  const offset = 100;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= offset) {
      current = section.id;
    }
  }
  links.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${current}`);
  });
}

window.addEventListener("scroll", onScroll);
onScroll();
