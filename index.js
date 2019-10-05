const express = require('express'),
  body_parser = require('body-parser'),
  fetch = require('node-fetch'),
  cheerio = require('cheerio'),
  WordPOS = require('wordpos')

const app = express()
const config = require('./config.json')
const wordpos = new WordPOS()

app.use(body_parser.json())
app.disable('etag')
app.disable('x-powered-by')


app.use(express.static('public'))

app.post('/execute_query', (req, res) => {
  if(req.body.question === '' 
      || req.body.option_1 === '' 
      || req.body.option_2 === '' 
      || req.body.option_3 === '' 
      || req.body.option_4 === '') {
    res.status(400).json({ response: 'Error: invalid arguments.' })

    return
  }

  const query = {
    question: req.body.question,
    possible_answers: [
      req.body.option_1,
      req.body.option_2,
      req.body.option_3,
      req.body.option_4
    ]
  }

  analyze_question(query.question, question_analysis => {
    lookup_words(query.possible_answers, 0, {}, words_lookup => {
      var looking_for_opposite = false // look for the opposite answer (switch synonyms and antonyms?)

      question_analysis.sentences.forEach((sentence, i) => {
        if(sentence.is_requesting_opposite) {
          looking_for_opposite = true
        }
      })

      // console.log(JSON.stringify(words))

      var adjectives_in_first_sentence = question_analysis.sentences[0].parts_of_speech.adjectives

      if(question_analysis.sentences[0].parts_of_speech.rest[0] !== '') {
        adjectives_in_first_sentence.push(question_analysis.sentences[0].parts_of_speech.rest[0])
      }
      // const nouns_in_first_sentence = question_analysis.sentences[0].parts_of_speech.nouns

      console.log(JSON.stringify(adjectives_in_first_sentence))
      // console.log(JSON.stringify(nouns_in_first_sentence))
      // console.log(JSON.stringify(question_analysis.sentences[0].parts_of_speech))

      lookup_words(adjectives_in_first_sentence, 0, {}, adjectives_lookup => {
        var similar_words = []

        if(looking_for_opposite) {
          for(var adjective in adjectives_lookup) {
            similar_words = similar_words.concat(adjectives_lookup[adjective].thesaurus.antonyms)
            // console.log(`DEBUG:::: ${JSON.stringify(adjectives_lookup[adjective].thesaurus.antonyms)}`)
          }
        } else {
          for(var adjective in adjectives_lookup) {
            similar_words = similar_words.concat(adjectives_lookup[adjective].thesaurus.synonyms)
          }
        }

        // Test adjectives in sentence against possible answers
        calculate_definitions_pos(words_lookup, definitions_pos => {
          const definition_adjective_map = {}

          // Fetch definitions for answers
          //   -----> Execute wordpos on definitions found, merge adjectives
          //            -----> Check against adjectives in question
          for(var definition = 0; definition < definitions_pos.length; definition++) {
            definition_adjective_map[query.possible_answers[definition]] = definitions_pos[definition].parts_of_speech.adjectives
          }

          console.log(JSON.stringify(definition_adjective_map))

          for(var i = 0; i < query.possible_answers.length; i++) {
            const possible_answer = query.possible_answers[i]
            var possible_answer_words = words_lookup[possible_answer].thesaurus.synonyms

            // add similar words for better matching
            possible_answer_words = possible_answer_words.concat(words_lookup[possible_answer].thesaurus.related_words)

            // console.log(`DEBUG: ${JSON.stringify(possible_answer_words)}`)

            for(var test = 0; test < possible_answer_words.length; test++) {
              if(similar_words.indexOf(possible_answer_words[test]) > -1) {
                res.json({ response: possible_answer })

                return
              }
            }

            // Test adjestives in sentence against definition's parts of speech
            for(var adjective = 0; adjective < adjectives_in_first_sentence.length; adjective++) {
              if(definition_adjective_map[possible_answer].indexOf(adjectives_in_first_sentence[adjective]) > -1) {
                res.json({ response: possible_answer })

                return
              }
            }
          }

          res.json({ response: 'Unknown' })
        })
      })
    })
  })
})

// lookup_word('ripe').then(res => console.log(JSON.stringify(res))).catch(err => console.error(err))
// analyze_question('The strawberry was so red and delicious, you could just taste how ripe it was from smelling it. Which of the following is the OPPOSITE of how you would describe the fruit?', res => console.log(JSON.stringify(res)))

function analyze_question(question, callback) {
  const parsed_sentences = question.replace(/(\.+|\:|\!|\?)(\"*|\'*|\)*|}*|]*)(\s|\n|\r|\r\n)/gm, "$1$2|").split("|")

  calculate_pos(parsed_sentences, 0, [], sentences_pos => {
    const analysis = { sentences: sentences_pos }

    analysis.sentences.forEach((sentence, i) => {
      // sentence_type - TODO: detect sentences giving commands (could end with . or !)
      switch(sentence.text.charAt(sentence.text.length-1)) {
        case '.':
          sentence.sentence_type = 'declarative'
          break
        case '?':
          sentence.sentence_type = 'question'
          break
        case '!':
          sentence.sentence_type = 'exclamatory'
          break
        default:
          sentence.sentence_type = 'unknown'
          break
      }

      sentence.is_requesting_opposite = sentence.parts_of_speech.adverbs.indexOf('opposite') > -1 
        || sentence.parts_of_speech.adverbs.indexOf('OPPOSITE') > -1
      
      // hacky method to detect answer placeholders until i figure out a regex expression
      var underscore_size = 0
      var underscore_start = 0

      for(var i=0; i<sentence.text.length; i++) {
        const char = sentence.text.charAt(i)

        if(char === '_') {
          if(underscore_size === 0) {
            underscore_start = i
          }

          underscore_size++
        } else if(underscore_size > 0) {
          sentence.text = sentence.text.substring(0, underscore_start) 
            + '{ANSWER}' 
            + sentence.text.substring(underscore_start+underscore_size, sentence.text.length)
          underscore_size = 0
        }
      }

      sentence.is_fill_in_blank_question = sentence.text.indexOf('{ANSWER}') > -1
    })

    console.log(JSON.stringify(analysis))

    callback(analysis)
  })
}

function calculate_pos(sentences, current_sentence, sentences_pos, callback) {
  if(current_sentence >= sentences.length) {
    callback(sentences_pos)
  } else {
    const sentence = sentences[current_sentence]

    wordpos.getPOS(sentence, output => {
      sentences_pos.push({
        text: sentence,
        parts_of_speech: output
      })

      calculate_pos(sentences, current_sentence+1, sentences_pos, callback)
    })
  }
}

function calculate_definitions_pos(definitions, callback) {
  const sentences = []

  for(var definition in definitions) {
    sentences.push(definitions[definition].dictionary.definitions.join(' '))
  }
  
  // console.log(`DEFINITIONS DEBUG: ${JSON.stringify(sentences)}`)

  calculate_pos(sentences, 0, [], callback)
}

function lookup_words(words, current_word, result, callback) {
  if(current_word >= words.length) {
    callback(result)
  } else {
    const word = words[current_word]

    lookup_word(word).then(res => {
      result[word] = res

      lookup_words(words, current_word+1, result, callback)
    }).catch(err => callback(false, err))
  }
}

function lookup_word(word) {
  return new Promise((resolve, reject) => {
    fetch(`https://www.merriam-webster.com/dictionary/${word}`).then(res => {
      if(res.status === 200) {
        res.text().then(body => {
          const $ = cheerio.load(body)

          const word_info = {
            dictionary: {
              type_of_speech: $('#left-content > div.row.entry-header > div > span > a').html(),
              definitions: [],
              example_sentences: []
            },
            thesaurus: {
              synonyms: [],
              related_words: [],
              near_antonyms: [],
              antonyms: []
            }
          }

          $('span .dtText').map((i, el) => word_info.dictionary.definitions.push($(el).text().replace(': ', '').replace(/\s+/g, ' ')))

          $('span[data-example-id]').map((i, el) => word_info.dictionary.example_sentences.push($(el).find('.t').text()))

          fetch(`https://www.merriam-webster.com/thesaurus/${word}`).then(res => {
            if(res.status === 200) {
              res.text().then(body => {
                const $ = cheerio.load(body)

                if($('h1.hword').text() === word) {
                  $('span .thes-list.syn-list .thes-list-content p a').map((i, el) => {
                    word_info.thesaurus.synonyms.push($(el).text())
                  })

                  $('span .thes-list.rel-list .thes-list-content p a').map((i, el) => {
                    word_info.thesaurus.related_words.push($(el).text())
                  })

                  $('span .thes-list.near-list .thes-list-content p a').map((i, el) => {
                    word_info.thesaurus.near_antonyms.push($(el).text())
                  })

                  $('span .thes-list.ant-list .thes-list-content p a').map((i, el) => {
                    word_info.thesaurus.antonyms.push($(el).text())
                  })
  
                  resolve(word_info)
                } else {
                  resolve(word_info)
                }
              }).catch(err => {
                console.error(err)

                resolve(word_info)
              })
            } else {
              resolve(word_info)
            }
          }).catch(err => {
            console.error(err)

            resolve(word_info)
          })
        }).catch(err => reject(err))
      } else {
        reject('Word does not exist.')
      }
    }).catch(err => reject(err))
  })
}

app.listen(config.port, () => console.log(`App listening on port ${config.port}!`))