// thank you to chatgpt for writing this
export function formatDate(date) {
  let year = date.getFullYear();
  let month = date.getMonth() + 1;  // Months are zero-indexed in JavaScript
  let day = date.getDate();

  // Pad single digit month and day values with a leading zero
  month = month < 10 ? '0' + month : month;
  day = day < 10 ? '0' + day : day;

  return `${year}-${month}-${day}`;
}

export function isWithinPastNDays(date, n) {
  const nDaysAgo = new Date();
  nDaysAgo.setDate(nDaysAgo.getDate() - n);  // Subtract n days from the current date

  return date >= nDaysAgo;
}