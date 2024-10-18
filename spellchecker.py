import re
from pathlib import Path
from transformers import BertTokenizer, BertForMaskedLM
import torch

class SpellChecker:
    def __init__(self, vocab_path: Path):
        self.vocab_path = vocab_path
        self.vocab = self.load_vocab(vocab_path)

        # Initialize BERT tokenizer and model
        #self.tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
        #self.model = BertForMaskedLM.from_pretrained('bert-base-uncased')

        self.tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
        self.model = BertForMaskedLM.from_pretrained('data/finetuned4992/')

    def load_vocab(self, vocab_path: Path) -> set:
        with open(vocab_path, 'r', encoding='utf-8') as file:
            vocab = set(line.lower().strip() for line in file)
        return vocab
    
    """
        Norvig Portion
    """
    def candidates(self, word): 
        "Generate possible spelling corrections for word."
        return (self.known([word]) or self.known(self.edits1(word)) or self.known(self.edits2(word)) or [word])

    def known(self, words): 
        "The subset of `words` that appear in the dictionary of WORDS."
        return set(w for w in words if w in self.vocab)

    def edits1(self, word):
        "All edits that are one edit away from `word`."
        letters    = 'abcdefghijklmnopqrstuvwxyz'
        splits     = [(word[:i], word[i:]) for i in range(len(word) + 1)]
        deletes    = [L + R[1:]              for L, R in splits if R]
        transposes = [L + R[1] + R[0] + R[2:] for L, R in splits if len(R) > 1]
        replaces   = [L + c + R[1:]          for L, R in splits if R for c in letters]
        inserts    = [L + c + R              for L, R in splits for c in letters]
        return set(deletes + transposes + replaces + inserts)

    def edits2(self, word): 
        "All edits that are two edits away from `word`."
        return (e2 for e1 in self.edits1(word) for e2 in self.edits1(e1))

    """
        Processing sentence
    """
    def tokenize_sentence(self, sentence: str) -> list:
        # regex to split sentence
        tokens = re.findall(r"\w+|[^\w\s]", sentence, re.UNICODE)
        return tokens
    
    def find_spelling_error(self, sentence: str) -> dict:
        tokenized_sentence = self.tokenize_sentence(sentence)
        spelling_errors = {}
        
        # Loop through each token
        for index, token in enumerate(tokenized_sentence):
            word = re.sub(r'[^a-zA-Z]', '', token).lower()

            # If the cleaned word is not in the vocabulary and it's not an empty string, add to errors
            if word and word not in self.vocab:
                spelling_errors[token] = index

        return spelling_errors

    def correct_error(self, sentence: str, error_word: str) -> str:
        # Get candidates for the misspelled word
        candidates = list(self.candidates(error_word))

        # Prepare the input text with the [MASK]
        masked_text = sentence.replace(error_word, "[MASK]")

        # Tokenize the input text
        inputs = self.tokenizer(masked_text, return_tensors='pt')

        # Get the index of the [MASK] token
        mask_token_index = torch.where(inputs['input_ids'] == self.tokenizer.mask_token_id)[1]

        if len(mask_token_index) == 0:
            print("No [MASK] token found in input.")
            return sentence

        # Iterate through each candidate and score it using BERT
        scores = []
        for candidate in candidates:
            print(candidate)
            # Replace [MASK] with the candidate word in the tokenized input
            inputs_with_candidate = self.tokenizer(sentence.replace(error_word, candidate), return_tensors='pt')

            # Predict the logits using BERT
            with torch.no_grad():
                outputs = self.model(**inputs_with_candidate)
                predictions = outputs.logits

            # Get the logits for the masked token
            candidate_logits = predictions[0, mask_token_index[0]]

            # Convert logits to probabilities
            candidate_prob = torch.nn.functional.softmax(candidate_logits, dim=-1)

            # Get the probability for the candidate word
            candidate_id = self.tokenizer.convert_tokens_to_ids(candidate)
            candidate_score = candidate_prob[candidate_id].item()

            scores.append(candidate_score)
        print(scores)
        # Find the best candidate (highest score)
        best_candidate_index = scores.index(max(scores))
        best_candidate = candidates[best_candidate_index]

        print(f"Best candidate for '{error_word}': {best_candidate}")
        return sentence.replace(error_word, best_candidate)

    def correct(self, sentence: str) -> str:
        # Get misspelled words and their indices
        errors = self.find_spelling_error(sentence)
        print('original: ', sentence)
        print('errors: ', errors)
        
        # Correct each misspelled word using BERT scoring
        for misspelled_word, _ in errors.items():
            sentence = self.correct_error(sentence, misspelled_word)

        return sentence

def main() -> None:
    checker = SpellChecker(Path('data/vocab.txt'))
    corrected_sentence = checker.correct("The catechits taught me the seven sakramens")
    print("Final corrected sentence:", corrected_sentence)

main()
