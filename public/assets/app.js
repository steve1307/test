document.getElementById('form').onsubmit = () => {
  execute_query(document.getElementById('question').value, 
    document.getElementById('option_1').value, document.getElementById('option_2').value, 
    document.getElementById('option_3').value, document.getElementById('option_4').value)

  return false
}

function execute_query(question, option_1, option_2, option_3, option_4) {
  fetch('/execute_query', {
    method: 'post',
    body: JSON.stringify({
      question: question,
      option_1: option_1,
      option_2: option_2,
      option_3: option_3,
      option_4: option_4
    }),
    headers: { 'Content-Type': 'application/json' }
  }).then(res => res.json()).then(json => {
    document.getElementById('answer').innerHTML = json.response
  }).catch(err => alert(err))
}