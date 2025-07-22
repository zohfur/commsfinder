import pandas as pd
import unicodedata
import re
from typing import Optional, List, Dict
import logging

class UnicodePreprocessor:
    """
    Utility class for preprocessing unicode characters and emojis in text data
    for machine learning applications.
    """
    
    def __init__(self):
        # Unicode directional/formatting characters that usually don't add semantic value
        self.formatting_chars = [
            '\u202A',  # LEFT-TO-RIGHT EMBEDDING
            '\u202B',  # RIGHT-TO-LEFT EMBEDDING
            '\u202C',  # POP DIRECTIONAL FORMATTING
            '\u202D',  # LEFT-TO-RIGHT OVERRIDE
            '\u202E',  # RIGHT-TO-LEFT OVERRIDE
            '\u2066',  # LEFT-TO-RIGHT ISOLATE
            '\u2067',  # RIGHT-TO-LEFT ISOLATE
            '\u2068',  # FIRST STRONG ISOLATE
            '\u2069',  # POP DIRECTIONAL ISOLATE
            '\u200B',  # ZERO WIDTH SPACE
            '\u200C',  # ZERO WIDTH NON-JOINER
            '\u200D',  # ZERO WIDTH JOINER
            '\uFEFF',  # ZERO WIDTH NO-BREAK SPACE
        ]
        
        # Regex patterns for different unicode categories
        self.emoji_pattern = re.compile(
            "["
            "\U0001F600-\U0001F64F"  # emoticons
            "\U0001F300-\U0001F5FF"  # symbols & pictographs
            "\U0001F680-\U0001F6FF"  # transport & map symbols
            "\U0001F1E0-\U0001F1FF"  # flags (iOS)
            "\U0001F900-\U0001F9FF"  # supplemental symbols
            "\U00002600-\U000026FF"  # miscellaneous symbols
            "\U00002700-\U000027BF"  # dingbats
            "]+", flags=re.UNICODE
        )
    
    def analyze_unicode(self, text: str) -> Dict[str, List[str]]:
        """
        Analyze unicode characters in text and categorize them.
        
        Args:
            text: Input text to analyze
            
        Returns:
            Dictionary with categories of unicode characters found
        """
        analysis = {
            'emojis': [],
            'special_symbols': [],
            'formatting_chars': [],
            'accented_chars': [],
            'other_unicode': []
        }
        
        for char in text:
            if ord(char) > 127:  # Non-ASCII character
                if char in self.formatting_chars:
                    analysis['formatting_chars'].append(char)
                elif self.emoji_pattern.match(char):
                    analysis['emojis'].append(char)
                elif unicodedata.category(char).startswith('M'):  # Mark characters (accents, etc.)
                    analysis['accented_chars'].append(char)
                elif unicodedata.category(char) in ['Sm', 'So', 'Sc', 'Sk']:  # Symbol characters
                    analysis['special_symbols'].append(char)
                else:
                    analysis['other_unicode'].append(char)
        
        # Remove duplicates
        for key in analysis:
            analysis[key] = list(set(analysis[key]))
            
        return analysis
    
    def clean_formatting_chars(self, text: str) -> str:
        """
        Remove unicode formatting characters that don't add semantic value.
        
        Args:
            text: Input text
            
        Returns:
            Text with formatting characters removed
        """
        for char in self.formatting_chars:
            text = text.replace(char, '')
        return text
    
    def normalize_unicode(self, text: str, form: str = 'NFC') -> str:
        """
        Normalize unicode text using specified form.
        
        Args:
            text: Input text
            form: Normalization form ('NFC', 'NFD', 'NFKC', 'NFKD')
            
        Returns:
            Normalized text
        """
        return unicodedata.normalize(form, text)
    
    def remove_emojis(self, text: str) -> str:
        """
        Remove all emojis from text.
        
        Args:
            text: Input text
            
        Returns:
            Text with emojis removed
        """
        return self.emoji_pattern.sub('', text)
    
    def replace_emojis_with_text(self, text: str) -> str:
        """
        Replace common emojis with text descriptions.
        
        Args:
            text: Input text
            
        Returns:
            Text with emojis replaced by descriptions
        """
        emoji_replacements = {
            '🎨': ' [art] ',
            '💜': ' [heart] ',
            '🔞': ' [adult] ',
            '🌙': ' [moon] ',
            '☕': ' [coffee] ',
            '🐂': ' [bull] ',
            '✨': ' [sparkles] ',
            '💤': ' [sleep] ',
            '🍋': ' [lemon] ',
            '🔥': ' [fire] ',
            '⭐': ' [star] ',
            '🌟': ' [glowing_star] ',
            '💫': ' [dizzy] ',
            '🎯': ' [target] ',
            '🚀': ' [rocket] ',
            '💎': ' [diamond] ',
            '🎪': ' [circus] ',
            '🌈': ' [rainbow] ',
            '🎃': ' [pumpkin] ',
            '🎄': ' [christmas_tree] ',
            '💘': ' [cupid] ',
            '🎊': ' [confetti] ',
            '🌸': ' [cherry_blossom] ',
            '☀️': ' [sun] ',
            '🍂': ' [fallen_leaves] ',
            '❄️': ' [snowflake] ',
            '🎮': ' [video_game] ',
            '🐾': ' [paw_prints] ',
            '🏳️‍🌈': ' [pride_flag] ',
            '🏳️‍⚧️': ' [trans_flag] ',
        }
        
        for emoji, replacement in emoji_replacements.items():
            text = text.replace(emoji, replacement)
        
        # Handle remaining emojis with generic placeholder
        text = self.emoji_pattern.sub(' [emoji] ', text)
        
        return text
    
    def preprocess_text(self, text: str, 
                       remove_formatting: bool = True,
                       normalize: bool = True,
                       emoji_handling: str = 'keep') -> str:
        """
        Comprehensive text preprocessing for ML training.
        
        Args:
            text: Input text
            remove_formatting: Whether to remove formatting characters
            normalize: Whether to normalize unicode
            emoji_handling: How to handle emojis ('keep', 'remove', 'replace')
            
        Returns:
            Preprocessed text
        """
        if not isinstance(text, str):
            return str(text)
        
        # Remove formatting characters
        if remove_formatting:
            text = self.clean_formatting_chars(text)
        
        # Normalize unicode
        if normalize:
            text = self.normalize_unicode(text)
        
        # Handle emojis
        if emoji_handling == 'remove':
            text = self.remove_emojis(text)
        elif emoji_handling == 'replace':
            text = self.replace_emojis_with_text(text)
        # 'keep' means do nothing
        
        # Clean up extra whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
    def process_dataframe(self, df: pd.DataFrame, 
                         text_column: str,
                         emoji_handling: str = 'keep',
                         create_analysis: bool = False) -> pd.DataFrame:
        """
        Process a dataframe with text data.
        
        Args:
            df: Input dataframe
            text_column: Name of the column containing text
            emoji_handling: How to handle emojis ('keep', 'remove', 'replace')
            create_analysis: Whether to create unicode analysis columns
            
        Returns:
            Processed dataframe
        """
        df = df.copy()
        
        # Preprocess text
        df[f'{text_column}_processed'] = df[text_column].apply(
            lambda x: self.preprocess_text(x, emoji_handling=emoji_handling)
        )
        
        if create_analysis:
            # Add analysis columns
            df[f'{text_column}_has_emojis'] = df[text_column].apply(
                lambda x: bool(self.emoji_pattern.search(str(x)))
            )
            
            df[f'{text_column}_emoji_count'] = df[text_column].apply(
                lambda x: len(self.emoji_pattern.findall(str(x)))
            )
            
            df[f'{text_column}_unicode_categories'] = df[text_column].apply(
                lambda x: str(list(self.analyze_unicode(str(x)).keys()))
            )
        
        return df


def analyze_dataset_unicode(csv_path: str, text_column: str = 'Text'):
    """
    Analyze unicode content in a dataset and provide recommendations.
    
    Args:
        csv_path: Path to the CSV file
        text_column: Name of the text column to analyze
    """
    processor = UnicodePreprocessor()
    
    # Load data
    df = pd.read_csv(csv_path)
    
    print(f"Analyzing unicode content in {csv_path}")
    print(f"Dataset shape: {df.shape}")
    print("\n" + "="*50)
    
    # Overall statistics
    total_texts = len(df)
    texts_with_unicode = 0
    texts_with_emojis = 0
    all_unicode_chars = set()
    all_emojis = set()
    
    for text in df[text_column]:
        if pd.isna(text):
            continue
            
        text = str(text)
        analysis = processor.analyze_unicode(text)
        
        # Check if text has any unicode
        has_unicode = any(len(chars) > 0 for chars in analysis.values())
        if has_unicode:
            texts_with_unicode += 1
            
        # Check if text has emojis
        if analysis['emojis']:
            texts_with_emojis += 1
            all_emojis.update(analysis['emojis'])
            
        # Collect all unicode characters
        for char_list in analysis.values():
            all_unicode_chars.update(char_list)
    
    print(f"Unicode Statistics:")
    print(f"- Texts with unicode characters: {texts_with_unicode}/{total_texts} ({texts_with_unicode/total_texts*100:.1f}%)")
    print(f"- Texts with emojis: {texts_with_emojis}/{total_texts} ({texts_with_emojis/total_texts*100:.1f}%)")
    print(f"- Unique unicode characters found: {len(all_unicode_chars)}")
    print(f"- Unique emojis found: {len(all_emojis)}")
    
    if all_emojis:
        print(f"\nMost common emojis: {sorted(list(all_emojis))[:20]}")
if __name__ == "__main__":
    # Example usage
    processor = UnicodePreprocessor()
    
    # Analyze your dataset
    analyze_dataset_unicode("crowdsourced_dataset.csv", "Text") 